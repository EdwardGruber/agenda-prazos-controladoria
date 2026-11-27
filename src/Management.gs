var HISTORY_NAME_ = 'Histórico da Agenda';
var HISTORY_HEADER_ = ['ID do registro', 'Data e hora', 'E-mail', 'Ação', 'Campos'];

function existingHistory_(ss) {
  var log = ss.getSheetByName(HISTORY_NAME_);
  if (log && log.getRange(1, 1, 1, 5).getDisplayValues()[0].join('|') !== HISTORY_HEADER_.join('|')) {
    throw new Error('A aba ' + HISTORY_NAME_ + ' já existe com outro formato.');
  }
  return log;
}

function readHistory_(ss) {
  var log = existingHistory_(ss);
  var events = Object.create(null);
  if (log && log.getLastRow() > 1) {
    log.getRange(2, 1, log.getLastRow() - 1, 5).getDisplayValues().forEach(function (row) {
      (events[row[0]] || (events[row[0]] = [])).push({ at: row[1], email: row[2], action: row[3], fields: row[4] });
    });
  }
  return events;
}

function optionsKey_(target) {
  return 'LISTAS_' + target.spreadsheet.getId() + '_' + target.sheet.getSheetId();
}

function readManagedOptions_(target) {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty(optionsKey_(target)) || '{}');
}

function apiChangeOption(payload) {
  var target = openTargetSheet(getAgendaConfig());
  var access = resolveUserAccess(target.spreadsheet, target.sheet);
  if (!access.canEdit) throw new Error('Apenas editores podem gerenciar opções.');
  var key = payload && payload.key;
  var name = String(payload && payload.name || '').trim();
  if (['responsavel', 'priorizacao'].indexOf(key) < 0 || !name || name.length > 120 ||
      ['add', 'remove'].indexOf(payload.action) < 0) throw new Error('Opção inválida.');
  var lock = acquireAgendaLock();
  try {
    var managed = readManagedOptions_(target);
    var list = managed[key] || fetchAgendaSnapshot().options[key];
    var filtered = list.filter(function (v) { return normalizeText(v) !== normalizeText(name); });
    if (payload.action === 'add') {
      if (filtered.length === list.length) list.push(name);
      managed[key] = list;
    } else managed[key] = filtered;
    var update = {};
    update[optionsKey_(target)] = JSON.stringify(managed);
    PropertiesService.getScriptProperties().setProperties(update, false);
    return { ok: true, key: key, options: managed[key] };
  } finally { lock.releaseLock(); }
}

function textCell_(value) {
  return { userEnteredValue: { stringValue: String(value) } };
}

function writeAgendaEvent_(target, config, row, idCol, id, diffs, access, savedAt, action, setId) {
  if (!access.canEdit || access.email.indexOf('@') < 1) throw new Error('É preciso entrar com uma conta editora identificada.');
  var sheet = target.sheet;
  var sid = sheet.getSheetId();
  var requests = [];
  function put(r, c, cell, fields) {
    requests.push({ updateCells: { start: { sheetId: sid, rowIndex: r - 1, columnIndex: c - 1 },
      rows: [{ values: [cell] }], fields: fields || 'userEnteredValue' } });
  }
  if (row > sheet.getMaxRows()) requests.push({ appendDimension: { sheetId: sid, dimension: 'ROWS', length: row - sheet.getMaxRows() } });
  if (idCol < 0) {
    idCol = Math.max(17, sheet.getLastColumn() + 1);
    if (idCol > sheet.getMaxColumns()) requests.push({ appendDimension: { sheetId: sid, dimension: 'COLUMNS', length: idCol - sheet.getMaxColumns() } });
    put(1, idCol, textCell_(config.idColumnHeader));
  }
  if (setId) put(row, idCol, textCell_(id));
  var managed = readManagedOptions_(target);
  diffs.forEach(function (diff) {
    var cell = textCell_(diff.after);
    var fields = 'userEnteredValue';
    if (EDITABLE_FIELD_MAP[diff.field].date && diff.after) {
      cell = { userEnteredValue: { numberValue: Date.parse(diff.after + 'T00:00:00Z') / 86400000 + 25569 },
        userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/MM/yyyy' } } };
      fields += ',userEnteredFormat.numberFormat';
    }
    if (managed[diff.field]) {
      var list = managed[diff.field];
      if (diff.after && list.indexOf(diff.after) < 0) throw new Error('Opção indisponível. Atualize a agenda e escolha outro valor.');
      if (list.length) cell.dataValidation = { condition: { type: 'ONE_OF_LIST', values: list.map(function (v) { return { userEnteredValue: v }; }) }, strict: true, showCustomUi: true };
      fields += ',dataValidation';
    } else if (diff.field === 'proximosPassos') {
      fields += ',dataValidation';
    }
    if (!diff.after) delete cell.userEnteredValue;
    put(row, diff.col, cell, fields);
  });
  put(row, AGENDA_COLUMNS.ULTIMA_ATUALIZACAO, textCell_(savedAt));
  var log = existingHistory_(target.spreadsheet);
  var logId;
  var rows = [];
  if (log) logId = log.getSheetId();
  else {
    var used = target.spreadsheet.getSheets().map(function (s) { return s.getSheetId(); });
    logId = 1;
    while (used.indexOf(logId) >= 0) logId++;
    requests.push({ addSheet: { properties: { sheetId: logId, title: HISTORY_NAME_ } } });
    rows.push({ values: HISTORY_HEADER_.map(textCell_) });
  }
  rows.push({ values: [id, savedAt, access.email, action, diffs.map(function (d) { return d.label; }).join(', ')].map(textCell_) });
  requests.push({ appendCells: { sheetId: logId, rows: rows, fields: 'userEnteredValue' } });
  Sheets.Spreadsheets.batchUpdate({ requests: requests }, target.spreadsheet.getId());
  return idCol;
}

function apiCreateRecord(payload) {
  var config = getAgendaConfig();
  var target = openTargetSheet(config);
  var access = resolveUserAccess(target.spreadsheet, target.sheet);
  if (!access.canEdit) throw new Error('Apenas editores podem cadastrar processos.');
  if (!payload || !/^PRZ-[0-9a-f-]{36}$/i.test(payload.recordId) || !String((payload.changes || {}).numeroProcesso || '').trim()) throw new Error('Informe o número do processo.');
  var validation = validateUpdatePayload({ recordId: payload.recordId, expectedVersion: 'new', changes: payload.changes });
  if (!validation.valid) throw new Error(validation.message);
  var lock = acquireAgendaLock();
  try {
    var snap = fetchAgendaSnapshot();
    var existing = snap.records.find(function (r) { return r.id === payload.recordId; });
    if (existing) {
      if (!existing.history.some(function (e) { return e.action === 'Criação' && e.email === access.email; })) throw new Error('Identificador já utilizado.');
      return { ok: true, record: existing, savedAt: existing.ultimaAtualizacao };
    }
    var sheet = target.sheet;
    if (!sheet.getLastRow()) throw new Error('Prepare os cabeçalhos da agenda antes do cadastro.');
    var width = Math.max(16, sheet.getLastColumn());
    var idCol = findIdColumnIndex(sheet.getRange(1, 1, 1, width).getDisplayValues()[0], config.idColumnHeader);
    var row = sheet.getLastRow() + 1;
    var savedAt = formatTimestampBr(new Date(), config.timezone);
    var diffs = computeEditableDiff({}, validation.changes);
    idCol = writeAgendaEvent_(target, config, row, idCol, payload.recordId, diffs, access, savedAt, 'Criação', true);
    var range = sheet.getRange(row, 1, 1, Math.max(width, idCol));
    var record = mapSheetRowToRecord(range.getValues()[0], range.getDisplayValues()[0], row, idCol, config.timezone);
    record.history = readHistory_(target.spreadsheet)[record.id] || [];
    return { ok: true, record: record, savedAt: savedAt };
  } finally { lock.releaseLock(); }
}
