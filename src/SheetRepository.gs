/**
 * SheetRepository.gs
 * Camada de acesso ao Google Planilhas com:
 * - Respeito rigoroso às permissões do usuário (executeAs: USER_ACCESSING)
 * - Leitura 100% soment-leitura (nunca altera "Última atualização" nem cria colunas ao abrir)
 * - Identificador estável por linha (coluna técnica ID_CONTROLE_APP após a coluna P)
 * - Busca da linha pelo ID estável dentro de LockService (seguro mesmo após reordenação)
 * - Controle otimista de concorrência (conflito se outro colega editou o registro)
 * - Gravação seletiva célula a célula apenas nos campos alterados + Última atualização,
 *   preservando fórmulas, formatação e validações/listas suspensas da planilha
 */

/**
 * Abre a planilha e a aba configuradas.
 */
function openTargetSheet(config) {
  var spreadsheet = null;
  try {
    if (config.spreadsheetId) {
      spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
    } else {
      spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    }
  } catch (err) {
    throw createAppError(
      'ACCESS_DENIED',
      'Não foi possível abrir a planilha configurada. Verifique se você tem permissão de acesso no Google Drive e se o SPREADSHEET_ID está correto.'
    );
  }

  if (!spreadsheet) {
    throw createAppError(
      'CONFIG_MISSING',
      'Nenhuma planilha configurada. Defina SPREADSHEET_ID nas Propriedades do script ou vincule o script à cópia de trabalho.'
    );
  }

  var sheet = null;
  if (config.sheetName) {
    sheet = spreadsheet.getSheetByName(config.sheetName);
    if (!sheet) {
      throw createAppError(
        'SHEET_NOT_FOUND',
        'A aba "' + config.sheetName + '" não foi encontrada na planilha "' + spreadsheet.getName() + '".'
      );
    }
  } else {
    sheet = spreadsheet.getSheets()[0];
  }

  if (!sheet) {
    throw createAppError('SHEET_NOT_FOUND', 'A planilha não possui abas disponíveis.');
  }

  return {
    spreadsheet: spreadsheet,
    sheet: sheet
  };
}

function createAppError(code, message, extra) {
  var err = new Error(message);
  err.appCode = code;
  err.extra = extra || null;
  return err;
}

/**
 * Determina se o usuário atual tem permissão de edição ou somente leitura na planilha e na aba.
 * Aplicado tanto na carga inicial (para UX) quanto obrigatoriamente no servidor antes de gravar.
 */
function resolveUserAccess(spreadsheet, sheet) {
  var email = '';
  try {
    if (typeof Session !== 'undefined' && Session) {
      email = String(
        (Session.getActiveUser && Session.getActiveUser().getEmail()) ||
        (Session.getEffectiveUser && Session.getEffectiveUser().getEmail()) ||
        ''
      ).trim();
    }
  } catch (e) {
    email = '';
  }

  var canEditFile = false;
  var accessResolved = false;

  // 1) Verificação principal via DriveApp (considera compartilhamento direto, grupos e Drives compartilhados)
  try {
    if (typeof DriveApp !== 'undefined' && DriveApp && typeof DriveApp.getFileById === 'function' && email) {
      var file = DriveApp.getFileById(spreadsheet.getId());
      var perm = file.getAccess(email);
      if (
        perm === DriveApp.Permission.OWNER ||
        perm === DriveApp.Permission.EDIT ||
        perm === DriveApp.Permission.ORGANIZER ||
        perm === DriveApp.Permission.FILE_ORGANIZER
      ) {
        canEditFile = true;
        accessResolved = true;
      } else if (
        perm === DriveApp.Permission.VIEW ||
        perm === DriveApp.Permission.COMMENT ||
        perm === DriveApp.Permission.NONE
      ) {
        canEditFile = false;
        accessResolved = true;
      }
    }
  } catch (driveErr) {
    accessResolved = false;
  }

  // 2) Fallback via metadados da própria planilha
  if (!accessResolved && email) {
    try {
      var emailLower = email.toLowerCase();
      var owner = spreadsheet.getOwner && spreadsheet.getOwner();
      if (owner && String(owner.getEmail() || '').toLowerCase() === emailLower) {
        canEditFile = true;
        accessResolved = true;
      } else if (spreadsheet.getEditors) {
        var editors = spreadsheet.getEditors() || [];
        for (var i = 0; i < editors.length; i++) {
          if (String(editors[i].getEmail() || '').toLowerCase() === emailLower) {
            canEditFile = true;
            break;
          }
        }
        accessResolved = true;
      }
    } catch (metaErr) {
      canEditFile = false;
    }
  }

  // 3) Verifica se há proteção de aba que impeça edição pelo usuário atual
  var blockedByProtection = false;
  if (canEditFile && sheet && typeof sheet.getProtections === 'function') {
    try {
      var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET) || [];
      for (var p = 0; p < protections.length; p++) {
        if (typeof protections[p].canEdit === 'function' && !protections[p].canEdit()) {
          blockedByProtection = true;
          break;
        }
      }
    } catch (protErr) {
      // Se não foi possível ler proteções, mantém o resultado anterior
    }
  }

  var canEdit = Boolean(canEditFile && !blockedByProtection);

  return {
    email: email || 'usuário autenticado',
    canEdit: canEdit,
    role: canEdit ? 'EDITOR' : 'VIEWER',
    permissionLabel: canEdit ? 'Edição' : 'Somente leitura'
  };
}

/**
 * Localiza o índice (1-based) da coluna técnica ID_CONTROLE_APP a partir da coluna Q (17).
 * Retorna -1 se ainda não existir.
 */
function findIdColumnIndex(headerValues, idHeaderName) {
  var target = normalizeText(idHeaderName || DEFAULT_ID_HEADER);
  for (var colIdx = MIN_TECHNICAL_COL_INDEX - 1; colIdx < headerValues.length; colIdx++) {
    if (normalizeText(headerValues[colIdx]) === target) {
      return colIdx + 1;
    }
  }
  return -1;
}

/**
 * Lê opções de listas suspensas (DataValidation) configuradas na planilha para enriquecer os filtros/seletores.
 */
function readValidationDropdownOptions(sheet, lastRow) {
  var result = {
    tribunal: [],
    priorizacao: [],
    tipo: [],
    protocolado: [],
    responsavel: []
  };

  if (lastRow < FIRST_DATA_ROW_INDEX) {
    return result;
  }

  var sampleRow = FIRST_DATA_ROW_INDEX;
  var colMap = [
    { key: 'tribunal', col: AGENDA_COLUMNS.TRIBUNAL },
    { key: 'priorizacao', col: AGENDA_COLUMNS.PRIORIZACAO },
    { key: 'tipo', col: AGENDA_COLUMNS.TIPO },
    { key: 'protocolado', col: AGENDA_COLUMNS.PROTOCOLADO },
    { key: 'responsavel', col: AGENDA_COLUMNS.RESPONSAVEL }
  ];

  for (var i = 0; i < colMap.length; i++) {
    try {
      var rule = sheet.getRange(sampleRow, colMap[i].col).getDataValidation();
      if (!rule) {
        continue;
      }
      var criteriaType = rule.getCriteriaType();
      var criteriaValues = rule.getCriteriaValues();
      if (criteriaType === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST && Array.isArray(criteriaValues[0])) {
        result[colMap[i].key] = criteriaValues[0].map(function (v) { return String(v || '').trim(); }).filter(Boolean);
      } else if (criteriaType === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE && criteriaValues[0] && typeof criteriaValues[0].getDisplayValues === 'function') {
        var rangeVals = criteriaValues[0].getDisplayValues();
        var flat = [];
        for (var r = 0; r < rangeVals.length; r++) {
          for (var c = 0; c < rangeVals[r].length; c++) {
            var item = String(rangeVals[r][c] || '').trim();
            if (item) flat.push(item);
          }
        }
        result[colMap[i].key] = flat;
      }
    } catch (e) {
      // Ignora silenciosamente se validação não for suportada/acessível
    }
  }

  return result;
}

/**
 * Verifica se as colunas A..P de uma linha estão todas vazias.
 */
function isRowEmptyAtoP(rawRow, displayRow) {
  for (var c = 0; c < AGENDA_COLUMNS.OBSERVACAO_P; c++) {
    var d = displayRow && displayRow[c] !== undefined && displayRow[c] !== null ? String(displayRow[c]).trim() : '';
    var r = rawRow && rawRow[c] !== undefined && rawRow[c] !== null ? String(rawRow[c]).trim() : '';
    if (d !== '' || r !== '') {
      return false;
    }
  }
  return true;
}

/**
 * Converte uma linha da planilha em objeto de domínio padronizado.
 */
function mapSheetRowToRecord(rawRow, displayRow, rowNumber, idColIndex, timeZone) {
  var stableId = '';
  if (idColIndex > 0 && displayRow.length >= idColIndex) {
    stableId = preserveTextCell(rawRow[idColIndex - 1], displayRow[idColIndex - 1]);
  }

  var record = {
    id: stableId || null,
    tempRowKey: stableId ? null : 'TMP_ROW_' + rowNumber,
    hasStableId: Boolean(stableId),
    rowNumber: rowNumber,
    colA: preserveTextCell(rawRow[AGENDA_COLUMNS.COL_A - 1], displayRow[AGENDA_COLUMNS.COL_A - 1]),
    tribunal: preserveTextCell(rawRow[AGENDA_COLUMNS.TRIBUNAL - 1], displayRow[AGENDA_COLUMNS.TRIBUNAL - 1]),
    fimDoPrazo: parseSheetDate(rawRow[AGENDA_COLUMNS.FIM_DO_PRAZO - 1], displayRow[AGENDA_COLUMNS.FIM_DO_PRAZO - 1], timeZone),
    prazoLimiteJuntada: parseSheetDate(rawRow[AGENDA_COLUMNS.PRAZO_LIMITE_JUNTADA - 1], displayRow[AGENDA_COLUMNS.PRAZO_LIMITE_JUNTADA - 1], timeZone),
    numeroProcesso: preserveTextCell(rawRow[AGENDA_COLUMNS.NUMERO_PROCESSO - 1], displayRow[AGENDA_COLUMNS.NUMERO_PROCESSO - 1]),
    cliente: preserveTextCell(rawRow[AGENDA_COLUMNS.CLIENTE - 1], displayRow[AGENDA_COLUMNS.CLIENTE - 1]),
    proximosPassos: preserveTextCell(rawRow[AGENDA_COLUMNS.PROXIMOS_PASSOS - 1], displayRow[AGENDA_COLUMNS.PROXIMOS_PASSOS - 1]),
    priorizacao: preserveTextCell(rawRow[AGENDA_COLUMNS.PRIORIZACAO - 1], displayRow[AGENDA_COLUMNS.PRIORIZACAO - 1]),
    tipo: preserveTextCell(rawRow[AGENDA_COLUMNS.TIPO - 1], displayRow[AGENDA_COLUMNS.TIPO - 1]),
    ultimaAtualizacao: parseLastUpdated(rawRow[AGENDA_COLUMNS.ULTIMA_ATUALIZACAO - 1], displayRow[AGENDA_COLUMNS.ULTIMA_ATUALIZACAO - 1], timeZone),
    dataFatal: parseSheetDate(rawRow[AGENDA_COLUMNS.DATA_FATAL - 1], displayRow[AGENDA_COLUMNS.DATA_FATAL - 1], timeZone),
    dataJuntada: parseSheetDate(rawRow[AGENDA_COLUMNS.DATA_JUNTADA - 1], displayRow[AGENDA_COLUMNS.DATA_JUNTADA - 1], timeZone),
    observacaoM: preserveTextCell(rawRow[AGENDA_COLUMNS.OBSERVACAO_M - 1], displayRow[AGENDA_COLUMNS.OBSERVACAO_M - 1]),
    protocolado: preserveTextCell(rawRow[AGENDA_COLUMNS.PROTOCOLADO - 1], displayRow[AGENDA_COLUMNS.PROTOCOLADO - 1]),
    responsavel: preserveTextCell(rawRow[AGENDA_COLUMNS.RESPONSAVEL - 1], displayRow[AGENDA_COLUMNS.RESPONSAVEL - 1]),
    observacaoP: preserveTextCell(rawRow[AGENDA_COLUMNS.OBSERVACAO_P - 1], displayRow[AGENDA_COLUMNS.OBSERVACAO_P - 1])
  };

  record.version = computeRecordVersion(record);
  return record;
}

/**
 * Leitura completa da agenda (ESTRICTAMENTE SOMENTE LEITURA).
 * Nunca modifica células, nunca altera "Última atualização" e funciona para usuários VIEWER.
 */
function fetchAgendaSnapshot() {
  var config = getAgendaConfig();
  var target = openTargetSheet(config);
  var spreadsheet = target.spreadsheet;
  var sheet = target.sheet;
  var userAccess = resolveUserAccess(spreadsheet, sheet);

  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), AGENDA_COLUMNS.OBSERVACAO_P);

  var records = [];
  var missingIdCount = 0;
  var idColIndex = -1;

  if (lastRow >= HEADER_ROW_INDEX) {
    var range = sheet.getRange(1, 1, lastRow, lastCol);
    var rawValues = range.getValues();
    var displayValues = range.getDisplayValues();
    var headerRow = displayValues[HEADER_ROW_INDEX - 1] || [];
    idColIndex = findIdColumnIndex(headerRow, config.idColumnHeader);

    for (var r = FIRST_DATA_ROW_INDEX - 1; r < rawValues.length; r++) {
      if (isRowEmptyAtoP(rawValues[r], displayValues[r])) {
        continue;
      }
      var rec = mapSheetRowToRecord(rawValues[r], displayValues[r], r + 1, idColIndex, config.timezone);
      if (!rec.hasStableId) {
        missingIdCount++;
      }
      records.push(rec);
    }
  }

  var validationOptions = readValidationDropdownOptions(sheet, lastRow);
  var optionsCatalog = buildOptionsCatalog(records, validationOptions);

  return {
    ok: true,
    records: records,
    options: optionsCatalog,
    userAccess: userAccess,
    meta: {
      spreadsheetName: spreadsheet.getName(),
      sheetName: sheet.getName(),
      timezone: config.timezone,
      todayIso: getTodayIso(config.timezone),
      totalRecords: records.length,
      missingIdCount: missingIdCount,
      hasIdColumn: idColIndex > 0,
      idColumnHeader: config.idColumnHeader,
      isDemo: false,
      loadedAt: formatTimestampBr(new Date(), config.timezone)
    }
  };
}

/**
 * Obtém um lock adequado (funciona tanto em script vinculado quanto em Web App standalone).
 */
function acquireAgendaLock() {
  var lock = null;
  if (typeof LockService !== 'undefined' && LockService) {
    lock = (LockService.getDocumentLock && LockService.getDocumentLock()) ||
      (LockService.getScriptLock && LockService.getScriptLock());
  }
  if (lock) {
    var acquired = lock.tryLock ? lock.tryLock(15000) : (lock.waitLock(15000), true);
    if (!acquired) {
      throw createAppError(
        'LOCK_TIMEOUT',
        'A planilha está recebendo outra gravação neste instante. Tente novamente em alguns segundos.'
      );
    }
  }
  return lock;
}

/**
 * Inicializa a coluna técnica ID_CONTROLE_APP ao final da planilha (coluna Q em diante)
 * apenas para linhas preenchidas que ainda não possuem ID.
 * Não altera nenhuma coluna de A a P nem a data de Última atualização.
 */
function ensureStableIdsInSheet() {
  var config = getAgendaConfig();
  var target = openTargetSheet(config);
  var userAccess = resolveUserAccess(target.spreadsheet, target.sheet);

  if (!userAccess.canEdit) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Seu acesso à planilha é somente leitura. Apenas editores podem inicializar a coluna de IDs estáveis.'
    };
  }

  var lock = acquireAgendaLock();
  try {
    var sheet = target.sheet;
    var lastRow = sheet.getLastRow();
    var lastCol = Math.max(sheet.getLastColumn(), AGENDA_COLUMNS.OBSERVACAO_P);

    if (lastRow < HEADER_ROW_INDEX) {
      return { ok: true, createdCount: 0, message: 'A aba está vazia.' };
    }

    var headerValues = sheet.getRange(HEADER_ROW_INDEX, 1, 1, lastCol).getDisplayValues()[0];
    var idColIndex = findIdColumnIndex(headerValues, config.idColumnHeader);

    if (idColIndex === -1) {
      idColIndex = Math.max(MIN_TECHNICAL_COL_INDEX, lastCol + 1);
      sheet.getRange(HEADER_ROW_INDEX, idColIndex).setValue(config.idColumnHeader);
      lastCol = Math.max(lastCol, idColIndex);
    }

    if (lastRow < FIRST_DATA_ROW_INDEX) {
      SpreadsheetApp.flush();
      return { ok: true, createdCount: 0, idColIndex: idColIndex };
    }

    var dataRange = sheet.getRange(FIRST_DATA_ROW_INDEX, 1, lastRow - FIRST_DATA_ROW_INDEX + 1, lastCol);
    var rawValues = dataRange.getValues();
    var displayValues = dataRange.getDisplayValues();
    var createdCount = 0;

    for (var i = 0; i < rawValues.length; i++) {
      if (isRowEmptyAtoP(rawValues[i], displayValues[i])) {
        continue;
      }
      var existingId = preserveTextCell(rawValues[i][idColIndex - 1], displayValues[i][idColIndex - 1]);
      if (!existingId) {
        var newId = generateStableRecordId();
        sheet.getRange(FIRST_DATA_ROW_INDEX + i, idColIndex).setValue(newId);
        createdCount++;
      }
    }

    SpreadsheetApp.flush();
    return {
      ok: true,
      createdCount: createdCount,
      idColIndex: idColIndex
    };
  } finally {
    if (lock && typeof lock.releaseLock === 'function') {
      lock.releaseLock();
    }
  }
}

/**
 * Salva apenas os campos editáveis alterados + "Última atualização" na linha correspondente
 * ao identificador estável, validando permissão do usuário e conflito de edição simultânea.
 */
function saveRecordUpdate(payload) {
  var config = getAgendaConfig();
  var target = openTargetSheet(config);
  var spreadsheet = target.spreadsheet;
  var sheet = target.sheet;

  // 1) Bloqueio obrigatório no servidor para usuários somente leitura
  var userAccess = resolveUserAccess(spreadsheet, sheet);
  if (!userAccess.canEdit) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Seu acesso à planilha é somente leitura. O servidor bloqueou a gravação de alterações.'
    };
  }

  // 2) Validação dos dados enviados
  var validation = validateUpdatePayload(payload);
  if (!validation.valid) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: validation.message
    };
  }

  var lock = acquireAgendaLock();
  try {
    var lastRow = sheet.getLastRow();
    var lastCol = Math.max(sheet.getLastColumn(), AGENDA_COLUMNS.OBSERVACAO_P);

    if (lastRow < FIRST_DATA_ROW_INDEX) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Nenhum registro encontrado na planilha.'
      };
    }

    var allRange = sheet.getRange(1, 1, lastRow, lastCol);
    var rawValues = allRange.getValues();
    var displayValues = allRange.getDisplayValues();
    var headerRow = displayValues[HEADER_ROW_INDEX - 1] || [];
    var idColIndex = findIdColumnIndex(headerRow, config.idColumnHeader);

    var targetRowIndex = -1; // 1-based
    var needsIdBackfill = false;

    if (payload.recordId && idColIndex > 0) {
      for (var r = FIRST_DATA_ROW_INDEX - 1; r < rawValues.length; r++) {
        var rowId = preserveTextCell(rawValues[r][idColIndex - 1], displayValues[r][idColIndex - 1]);
        if (rowId === payload.recordId) {
          targetRowIndex = r + 1;
          break;
        }
      }
    } else if (payload.tempRowKey) {
      var parsedRow = /^TMP_ROW_(\d+)$/.exec(String(payload.tempRowKey));
      if (parsedRow) {
        var candidateRow = parseInt(parsedRow[1], 10);
        if (candidateRow >= FIRST_DATA_ROW_INDEX && candidateRow <= lastRow) {
          targetRowIndex = candidateRow;
          needsIdBackfill = true;
        }
      }
    }

    if (targetRowIndex === -1) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Registro não localizado na planilha (pode ter sido removido). Recarregue a agenda.'
      };
    }

    var liveRawRow = rawValues[targetRowIndex - 1];
    var liveDisplayRow = displayValues[targetRowIndex - 1];
    var liveRecord = mapSheetRowToRecord(liveRawRow, liveDisplayRow, targetRowIndex, idColIndex, config.timezone);

    // 3) Verificação de conflito de edição simultânea
    if (liveRecord.version !== payload.expectedVersion) {
      return {
        ok: false,
        code: 'CONFLICT',
        message: 'Conflito detectado: outro colega alterou este registro na planilha depois que você o abriu. Recarregue os dados atuais antes de salvar.',
        currentRecord: liveRecord
      };
    }

    // 4) Calcula apenas as células que realmente mudaram
    var diffs = computeEditableDiff(liveRecord, validation.changes);
    if (diffs.length === 0) {
      return {
        ok: false,
        code: 'NO_CHANGES',
        message: 'Nenhuma alteração foi feita nos campos editáveis.'
      };
    }

    // 5) Se o registro ainda não tinha ID estável, cria a coluna técnica e grava o ID agora
    if (needsIdBackfill) {
      if (idColIndex === -1) {
        idColIndex = Math.max(MIN_TECHNICAL_COL_INDEX, lastCol + 1);
        sheet.getRange(HEADER_ROW_INDEX, idColIndex).setValue(config.idColumnHeader);
        lastCol = Math.max(lastCol, idColIndex);
      }
      var generatedId = generateStableRecordId();
      sheet.getRange(targetRowIndex, idColIndex).setValue(generatedId);
    }

    // 6) Gravação seletiva: altera SOMENTE as células editadas + Última atualização
    //    Preserva fórmulas, formatação, coluna A ("3"), datas e listas suspensas.
    try {
      for (var d = 0; d < diffs.length; d++) {
        sheet.getRange(targetRowIndex, diffs[d].col).setValue(diffs[d].after);
      }

      var savedAt = formatTimestampBr(new Date(), config.timezone);
      sheet.getRange(targetRowIndex, AGENDA_COLUMNS.ULTIMA_ATUALIZACAO).setValue(savedAt);
      SpreadsheetApp.flush();
    } catch (writeErr) {
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'A planilha recusou a gravação. Verifique se você possui permissão de edição nesta aba.'
      };
    }

    // 7) Relê a linha confirmada diretamente da planilha para devolver o estado autoritativo
    var refreshedLastCol = Math.max(sheet.getLastColumn(), lastCol, idColIndex > 0 ? idColIndex : AGENDA_COLUMNS.OBSERVACAO_P);
    var updatedRange = sheet.getRange(targetRowIndex, 1, 1, refreshedLastCol);
    var updatedRaw = updatedRange.getValues()[0];
    var updatedDisplay = updatedRange.getDisplayValues()[0];
    var updatedRecord = mapSheetRowToRecord(updatedRaw, updatedDisplay, targetRowIndex, idColIndex, config.timezone);

    return {
      ok: true,
      record: updatedRecord,
      updatedFields: diffs.map(function (item) {
        return { field: item.field, label: item.label, before: item.before, after: item.after };
      }),
      savedAt: updatedRecord.ultimaAtualizacao
    };
  } finally {
    if (lock && typeof lock.releaseLock === 'function') {
      lock.releaseLock();
    }
  }
}
