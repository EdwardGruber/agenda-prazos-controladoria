/**
 * Domain.gs
 * Regras puras de negócio da Agenda de Prazos:
 * - Parsing e formatação de datas no fuso America/Sao_Paulo (valores nativos ou texto BR)
 * - Normalização de número do processo preservando zeros à esquerda e formatos atípicos
 * - Classificação da visão diária (prazos fatais do dia, juntadas do dia, pendentes de conferência)
 * - Cálculo de versão otimista para detecção de conflito de edição simultânea
 * - Validação de payloads de edição
 */

function normalizeText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeDigits(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).replace(/\D+/g, '');
}

function normalizeAlphanumeric(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return normalizeText(value).replace(/[^a-z0-9]+/g, '');
}

function pad2(num) {
  return num < 10 ? '0' + num : String(num);
}

/**
 * Verifica se ano/mês/dia compõem uma data real no calendário gregoriano.
 */
function isValidCalendarDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  var probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * Formata um objeto Date como YYYY-MM-DD no fuso configurado (America/Sao_Paulo).
 */
function formatDateToIsoInTimeZone(dateObj, timeZone) {
  var tz = timeZone || DEFAULT_TIMEZONE;
  if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
    return Utilities.formatDate(dateObj, tz, 'yyyy-MM-dd');
  }
  var parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(dateObj);

  var map = {};
  for (var i = 0; i < parts.length; i++) {
    map[parts[i].type] = parts[i].value;
  }
  return map.year + '-' + map.month + '-' + map.day;
}

/**
 * Formata data e hora no padrão brasileiro (dd/MM/yyyy HH:mm) em America/Sao_Paulo.
 */
function formatTimestampBr(dateObj, timeZone) {
  var tz = timeZone || DEFAULT_TIMEZONE;
  if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
    return Utilities.formatDate(dateObj, tz, 'dd/MM/yyyy HH:mm');
  }
  var parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(dateObj);

  var map = {};
  for (var i = 0; i < parts.length; i++) {
    map[parts[i].type] = parts[i].value;
  }
  return map.day + '/' + map.month + '/' + map.year + ' ' + map.hour + ':' + map.minute;
}

/**
 * Retorna a data de hoje (YYYY-MM-DD) no fuso America/Sao_Paulo.
 */
function getTodayIso(timeZone) {
  return formatDateToIsoInTimeZone(new Date(), timeZone || DEFAULT_TIMEZONE);
}

/**
 * Converte YYYY-MM-DD para DD/MM/YYYY.
 */
function isoToBrDisplay(iso) {
  if (!iso || typeof iso !== 'string') {
    return '';
  }
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) {
    return '';
  }
  return match[3] + '/' + match[2] + '/' + match[1];
}

/**
 * Faz o parse de uma célula de data da planilha, aceitando:
 * - Célula vazia -> permanece vazia (nunca deduzida de outra coluna)
 * - Objeto Date nativo do Google Planilhas (convertido em America/Sao_Paulo)
 * - Texto brasileiro com ou sem zero à esquerda (ex.: 5/3/2026, 05/03/2026, 5/3/26, com ou sem hora)
 * - Texto ISO YYYY-MM-DD
 * - Qualquer outro texto não reconhecido é preservado em display/raw com valid=false
 */
function parseSheetDate(rawValue, displayValue, timeZone) {
  var tz = timeZone || DEFAULT_TIMEZONE;

  if (rawValue instanceof Date && !isNaN(rawValue.getTime())) {
    var isoFromDate = formatDateToIsoInTimeZone(rawValue, tz);
    return {
      iso: isoFromDate,
      display: isoToBrDisplay(isoFromDate),
      raw: displayValue !== undefined && displayValue !== null && String(displayValue).trim() !== ''
        ? String(displayValue).trim()
        : isoToBrDisplay(isoFromDate),
      isEmpty: false,
      valid: true
    };
  }

  var candidate = '';
  if (rawValue !== null && rawValue !== undefined && String(rawValue).trim() !== '') {
    candidate = String(rawValue).trim();
  } else if (displayValue !== null && displayValue !== undefined && String(displayValue).trim() !== '') {
    candidate = String(displayValue).trim();
  }

  if (candidate === '') {
    return {
      iso: null,
      display: '',
      raw: '',
      isEmpty: true,
      valid: true
    };
  }

  // Formato brasileiro: D/M/YYYY ou DD/MM/YYYY ou D/M/YY (com hora opcional)
  var brMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(candidate);
  if (brMatch) {
    var day = parseInt(brMatch[1], 10);
    var month = parseInt(brMatch[2], 10);
    var year = parseInt(brMatch[3], 10);
    if (brMatch[3].length === 2) {
      year = 2000 + year;
    }
    if (isValidCalendarDate(year, month, day)) {
      var isoBr = year + '-' + pad2(month) + '-' + pad2(day);
      return {
        iso: isoBr,
        display: pad2(day) + '/' + pad2(month) + '/' + year,
        raw: candidate,
        isEmpty: false,
        valid: true
      };
    }
    return {
      iso: null,
      display: candidate,
      raw: candidate,
      isEmpty: false,
      valid: false
    };
  }

  // Formato ISO: YYYY-MM-DD (com hora opcional)
  var isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]\d{1,2}:\d{2}(?::\d{2})?)?/.exec(candidate);
  if (isoMatch) {
    var isoYear = parseInt(isoMatch[1], 10);
    var isoMonth = parseInt(isoMatch[2], 10);
    var isoDay = parseInt(isoMatch[3], 10);
    if (isValidCalendarDate(isoYear, isoMonth, isoDay)) {
      var isoNormalized = isoYear + '-' + pad2(isoMonth) + '-' + pad2(isoDay);
      return {
        iso: isoNormalized,
        display: pad2(isoDay) + '/' + pad2(isoMonth) + '/' + isoYear,
        raw: candidate,
        isEmpty: false,
        valid: true
      };
    }
  }

  return {
    iso: null,
    display: candidate,
    raw: candidate,
    isEmpty: false,
    valid: false
  };
}

/**
 * Formata a célula "Última atualização" mantendo texto legível em America/Sao_Paulo.
 */
function parseLastUpdated(rawValue, displayValue, timeZone) {
  var tz = timeZone || DEFAULT_TIMEZONE;
  if (rawValue instanceof Date && !isNaN(rawValue.getTime())) {
    return formatTimestampBr(rawValue, tz);
  }
  if (displayValue !== null && displayValue !== undefined && String(displayValue).trim() !== '') {
    return String(displayValue).trim();
  }
  if (rawValue !== null && rawValue !== undefined && String(rawValue).trim() !== '') {
    return String(rawValue).trim();
  }
  return '';
}

/**
 * Preserva o número do processo exatamente como texto (inclusive zeros iniciais).
 */
function preserveTextCell(rawValue, displayValue) {
  if (displayValue !== null && displayValue !== undefined && String(displayValue) !== '') {
    return String(displayValue).trim();
  }
  if (rawValue !== null && rawValue !== undefined) {
    return String(rawValue).trim();
  }
  return '';
}

function isProtocoladoNao(protocolado) {
  return normalizeText(protocolado) === 'nao';
}

function isProtocoladoSim(protocolado) {
  return normalizeText(protocolado) === 'sim';
}

/**
 * Classifica um registro em relação a uma data de referência (YYYY-MM-DD).
 *
 * Regras:
 * - Data fatal igual à data consultada -> Prazo fatal no dia
 * - Data da juntada igual à data consultada -> Juntada no dia
 * - Data fatal anterior à data consultada com Protocolado = "Não" -> Pendente de conferência
 *   (A passagem da data, sozinha, não comprova perda de prazo.)
 */
function classifyRecordForDate(record, referenceDateIso) {
  var fatalIso = record.dataFatal && record.dataFatal.iso ? record.dataFatal.iso : null;
  var juntadaIso = record.dataJuntada && record.dataJuntada.iso ? record.dataJuntada.iso : null;

  var isFatalOnDate = Boolean(fatalIso && fatalIso === referenceDateIso);
  var isJuntadaOnDate = Boolean(juntadaIso && juntadaIso === referenceDateIso);
  var isPendingReview = Boolean(
    fatalIso &&
    fatalIso < referenceDateIso &&
    isProtocoladoNao(record.protocolado)
  );

  var tags = [];
  if (isPendingReview) {
    tags.push('Pendente de conferência');
  }
  if (isFatalOnDate) {
    tags.push('Data fatal no dia');
  }
  if (isJuntadaOnDate) {
    tags.push('Juntada no dia');
  }

  return {
    inAttentionView: isFatalOnDate || isJuntadaOnDate || isPendingReview,
    isFatalOnDate: isFatalOnDate,
    isJuntadaOnDate: isJuntadaOnDate,
    isPendingReview: isPendingReview,
    tags: tags
  };
}

/**
 * Verifica se o registro corresponde à busca por número do processo (com ou sem pontuação,
 * incluindo formatos atípicos) ou por nome do cliente.
 */
function matchesSearchQuery(record, query) {
  if (!query || !String(query).trim()) {
    return true;
  }
  var qText = normalizeText(query);
  var qDigits = normalizeDigits(query);
  var qAlnum = normalizeAlphanumeric(query);

  var clienteNorm = normalizeText(record.cliente);
  if (qText && clienteNorm.indexOf(qText) !== -1) {
    return true;
  }

  var procNorm = normalizeText(record.numeroProcesso);
  if (qText && procNorm.indexOf(qText) !== -1) {
    return true;
  }

  var procAlnum = normalizeAlphanumeric(record.numeroProcesso);
  if (qAlnum && procAlnum.indexOf(qAlnum) !== -1) {
    return true;
  }

  // Só compara por dígitos puros se a busca tiver dígitos e não contiver letras
  var hasLetters = /[a-z]/i.test(qText);
  if (!hasLetters && qDigits) {
    var procDigits = normalizeDigits(record.numeroProcesso);
    if (procDigits && procDigits.indexOf(qDigits) !== -1) {
      return true;
    }
  }

  return false;
}

/**
 * Hash determinístico FNV-1a 64-bit simulado (dois hashes 32-bit) para controle de concorrência.
 * Detecta alterações feitas pelo app OU diretamente no Google Planilhas.
 */
function computeStringFingerprint(input) {
  var str = String(input || '');
  var h1 = 0x811c9dc5;
  var h2 = 0x9e3779b9;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return ('00000000' + (h1 >>> 0).toString(16)).slice(-8) +
    ('00000000' + (h2 >>> 0).toString(16)).slice(-8);
}

/**
 * Calcula o token de versão atual do registro a partir dos seus campos relevantes.
 */
function computeRecordVersion(record) {
  var snapshot = [
    String(record.numeroProcesso || ''),
    String(record.cliente || ''),
    String(record.tribunal || ''),
    String(record.tipo || ''),
    String((record.fimDoPrazo && record.fimDoPrazo.raw) || ''),
    String((record.prazoLimiteJuntada && record.prazoLimiteJuntada.raw) || ''),
    String((record.dataFatal && record.dataFatal.raw) || ''),
    String((record.dataJuntada && record.dataJuntada.raw) || ''),
    String(record.proximosPassos || ''),
    String(record.priorizacao || ''),
    String(record.observacaoM || ''),
    String(record.protocolado || ''),
    String(record.responsavel || ''),
    String(record.observacaoP || ''),
    String(record.ultimaAtualizacao || '')
  ].join('\u001f');

  return 'v1_' + computeStringFingerprint(snapshot);
}

/**
 * Compara os campos editáveis entre o estado atual da planilha e as alterações enviadas.
 */
function computeEditableDiff(liveRecord, proposedChanges) {
  var diffs = [];
  var fieldNames = Object.keys(EDITABLE_FIELD_MAP);

  for (var i = 0; i < fieldNames.length; i++) {
    var field = fieldNames[i];
    if (!Object.prototype.hasOwnProperty.call(proposedChanges, field)) {
      continue;
    }
    var beforeVal = String(liveRecord[field] || '').trim();
    var afterVal = String(proposedChanges[field] === null || proposedChanges[field] === undefined ? '' : proposedChanges[field]).trim();
    if (beforeVal !== afterVal) {
      diffs.push({
        field: field,
        col: EDITABLE_FIELD_MAP[field].col,
        label: EDITABLE_FIELD_MAP[field].label,
        before: beforeVal,
        after: afterVal
      });
    }
  }
  return diffs;
}

/**
 * Valida o payload de atualização antes de tocar na planilha.
 */
function validateUpdatePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, message: 'Dados de atualização inválidos.' };
  }
  if (!payload.recordId && !payload.tempRowKey) {
    return { valid: false, message: 'Identificador do registro ausente.' };
  }
  if (!payload.expectedVersion || typeof payload.expectedVersion !== 'string') {
    return { valid: false, message: 'Token de versão do registro ausente.' };
  }
  if (!payload.changes || typeof payload.changes !== 'object') {
    return { valid: false, message: 'Nenhum campo de alteração foi informado.' };
  }

  var allowedKeys = Object.keys(EDITABLE_FIELD_MAP);
  var receivedKeys = Object.keys(payload.changes);
  var sanitizedChanges = {};

  for (var i = 0; i < receivedKeys.length; i++) {
    var key = receivedKeys[i];
    if (allowedKeys.indexOf(key) === -1) {
      return { valid: false, message: 'Campo não permitido para edição: ' + key };
    }
    var raw = payload.changes[key];
    sanitizedChanges[key] = raw === null || raw === undefined ? '' : String(raw).trim();
  }

  if (Object.prototype.hasOwnProperty.call(sanitizedChanges, 'protocolado')) {
    var protVal = sanitizedChanges.protocolado;
    if (protVal !== '' && normalizeText(protVal) !== 'sim' && normalizeText(protVal) !== 'nao') {
      return { valid: false, message: 'Valor inválido para o campo Protocolado. Use "Sim" ou "Não".' };
    }
    if (normalizeText(protVal) === 'sim') {
      sanitizedChanges.protocolado = 'Sim';
    } else if (normalizeText(protVal) === 'nao') {
      sanitizedChanges.protocolado = 'Não';
    }
  }

  return {
    valid: true,
    changes: sanitizedChanges
  };
}

/**
 * Gera um identificador estável único para a coluna técnica ID_CONTROLE_APP.
 */
function generateStableRecordId() {
  if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.getUuid === 'function') {
    return 'PRZ-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  }
  var rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  var ts = Date.now().toString(36).slice(-4).toUpperCase();
  return 'PRZ-' + ts + rand.slice(0, 4);
}

/**
 * Consolida opções de filtros e listas suspensas a partir dos dados reais da planilha,
 * das validações de dados existentes e dos valores de referência da amostra.
 */
function mergeUniqueOptions(preferredOrder, dynamicLists) {
  var seen = {};
  var result = [];

  function addItem(item) {
    var trimmed = String(item || '').trim();
    if (!trimmed) {
      return;
    }
    var key = normalizeText(trimmed);
    if (!seen[key]) {
      seen[key] = true;
      result.push(trimmed);
    }
  }

  var i, j;
  if (Array.isArray(preferredOrder)) {
    for (i = 0; i < preferredOrder.length; i++) {
      addItem(preferredOrder[i]);
    }
  }
  if (Array.isArray(dynamicLists)) {
    for (i = 0; i < dynamicLists.length; i++) {
      var list = dynamicLists[i];
      if (Array.isArray(list)) {
        for (j = 0; j < list.length; j++) {
          addItem(list[j]);
        }
      }
    }
  }
  return result;
}

function buildOptionsCatalog(records, validationOptions) {
  var valOpts = validationOptions || {};
  var responsaveis = [];
  var tribunais = [];
  var prioridades = [];
  var tipos = [];
  var protocolos = [];

  for (var i = 0; i < records.length; i++) {
    var rec = records[i];
    if (rec.responsavel) responsaveis.push(rec.responsavel);
    if (rec.tribunal) tribunais.push(rec.tribunal);
    if (rec.priorizacao) prioridades.push(rec.priorizacao);
    if (rec.tipo) tipos.push(rec.tipo);
    if (rec.protocolado) protocolos.push(rec.protocolado);
  }

  var sortedResponsaveis = mergeUniqueOptions([], [valOpts.responsavel || [], responsaveis]).sort(function (a, b) {
    return a.localeCompare(b, 'pt-BR');
  });
  var sortedTribunais = mergeUniqueOptions([], [valOpts.tribunal || [], tribunais]).sort(function (a, b) {
    return a.localeCompare(b, 'pt-BR');
  });

  return {
    responsavel: sortedResponsaveis,
    tribunal: sortedTribunais,
    priorizacao: mergeUniqueOptions(DEFAULT_OPTIONS.priorizacao, [valOpts.priorizacao || [], prioridades]),
    tipo: mergeUniqueOptions(DEFAULT_OPTIONS.tipo, [valOpts.tipo || [], tipos]),
    protocolado: mergeUniqueOptions(DEFAULT_OPTIONS.protocolado, [valOpts.protocolado || [], protocolos])
  };
}
