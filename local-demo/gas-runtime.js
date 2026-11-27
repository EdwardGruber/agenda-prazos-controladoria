'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const {
  SAMPLE_HEADERS,
  SAMPLE_DROPDOWN_VALIDATIONS,
  buildSampleSheetRows
} = require('../sample-data/mock-records');

const SRC_DIR = path.resolve(__dirname, '..', 'src');

/**
 * Simulador fiel em memória do runtime Google Apps Script (V8) para:
 * - Executar os arquivos reais src/Config.gs, src/Domain.gs, src/SheetRepository.gs e src/Code.gs
 * - Simular planilha com células contendo valor, displayValue, fórmula, formatação e DataValidation
 * - Simular permissões por usuário (EDITOR vs VIEWER, incluindo proteção de aba)
 * - Simular reordenação de linhas e edições concorrentes de colegas
 */

function formatDateWithPattern(dateObj, timeZone, pattern) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone || 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(dateObj);
  const map = {};
  for (const p of parts) map[p.type] = p.value;

  if (pattern === 'yyyy-MM-dd') {
    return `${map.year}-${map.month}-${map.day}`;
  }
  if (pattern === 'dd/MM/yyyy HH:mm') {
    return `${map.day}/${map.month}/${map.year} ${map.hour}:${map.minute}`;
  }
  if (pattern === 'dd/MM/yyyy') {
    return `${map.day}/${map.month}/${map.year}`;
  }
  return `${map.day}/${map.month}/${map.year} ${map.hour}:${map.minute}:${map.second}`;
}

function makeCell(value, meta = {}) {
  const cell = {
    value: value === undefined ? '' : value,
    formula: meta.formula || null,
    format: meta.format ? { ...meta.format } : {},
    validation: meta.validation || null
  };
  return cell;
}

function cellDisplayValue(cell, timeZone) {
  if (!cell || cell.value === null || cell.value === undefined) return '';
  if (cell.value instanceof Date && !isNaN(cell.value.getTime())) {
    return formatDateWithPattern(cell.value, timeZone, 'dd/MM/yyyy');
  }
  return String(cell.value);
}

function createValidationRule(listValues) {
  return {
    getCriteriaType() {
      return 'VALUE_IN_LIST';
    },
    getCriteriaValues() {
      return [listValues.slice(), true];
    }
  };
}

class MockRange {
  constructor(sheet, startRow, startCol, numRows, numCols) {
    this.sheet = sheet;
    this.startRow = startRow;
    this.startCol = startCol;
    this.numRows = numRows;
    this.numCols = numCols;
  }

  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowArr = [];
      for (let c = 0; c < this.numCols; c++) {
        const cell = this.sheet._getCell(this.startRow + r, this.startCol + c);
        rowArr.push(cell.value);
      }
      out.push(rowArr);
    }
    return out;
  }

  getDisplayValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowArr = [];
      for (let c = 0; c < this.numCols; c++) {
        const cell = this.sheet._getCell(this.startRow + r, this.startCol + c);
        rowArr.push(cellDisplayValue(cell, 'America/Sao_Paulo'));
      }
      out.push(rowArr);
    }
    return out;
  }

  setValue(newValue) {
    this.sheet._assertWritable();
    const cell = this.sheet._ensureCell(this.startRow, this.startCol);
    cell.value = newValue;
    // Gravação seletiva preserva cell.format e cell.validation; sobrescreve formula apenas da célula editada
    cell.formula = null;
    this.sheet._writeLog.push({
      row: this.startRow,
      col: this.startCol,
      value: newValue,
      at: new Date().toISOString()
    });
    return this;
  }

  getDataValidation() {
    const cell = this.sheet._getCell(this.startRow, this.startCol);
    return cell.validation || null;
  }
}

class MockSheet {
  constructor(spreadsheet, name) {
    this.spreadsheet = spreadsheet;
    this.name = name;
    this.rows = []; // Array de arrays de cell objects
    this.protections = [];
    this._writeLog = [];
  }

  getSheetId() { return this.id || 0; }
  getMaxRows() { return Math.max(1000, this.rows.length); }
  getMaxColumns() { return Math.max(26, this.getLastColumn()); }

  getName() {
    return this.name;
  }

  getLastRow() {
    return this.rows.length;
  }

  getLastColumn() {
    let maxCol = 0;
    for (const row of this.rows) {
      if (row.length > maxCol) maxCol = row.length;
    }
    return maxCol;
  }

  _getCell(row1, col1) {
    const row = this.rows[row1 - 1];
    if (!row || !row[col1 - 1]) return makeCell('');
    return row[col1 - 1];
  }

  _ensureCell(row1, col1) {
    while (this.rows.length < row1) {
      this.rows.push([]);
    }
    const row = this.rows[row1 - 1];
    while (row.length < col1) {
      row.push(makeCell(''));
    }
    return row[col1 - 1];
  }

  _assertWritable() {
    const active = this.spreadsheet.runtime.currentUser;
    const perm = this.spreadsheet.permissions[active.email] || 'NONE';
    if (perm !== 'OWNER' && perm !== 'EDIT') {
      throw new Error('Exception: You do not have permission to edit this spreadsheet.');
    }
    for (const prot of this.protections) {
      if (!prot.canEdit()) {
        throw new Error('Exception: Sheet is protected against edits by this user.');
      }
    }
  }

  getRange(startRow, startCol, numRows = 1, numCols = 1) {
    return new MockRange(this, startRow, startCol, numRows, numCols);
  }

  getProtections() {
    return this.protections;
  }
}

function createGasRuntime(options = {}) {
  const spreadsheetId = options.spreadsheetId || 'DEMO_SPREADSHEET_CONTROLADORIA';
  const spreadsheetName = options.spreadsheetName || 'Agenda Controladoria Bancária (Demonstração)';
  const sheetName = options.sheetName || 'Prazos';
  const includeIds = options.includeIds !== false;

  const runtime = {
    currentUser: {
      email: options.userEmail || 'controladoria@escritorio-exemplo.local',
      role: options.userRole || 'EDITOR'
    },
    properties: {
      SPREADSHEET_ID: spreadsheetId,
      SHEET_NAME: sheetName,
      TIMEZONE: 'America/Sao_Paulo',
      ID_COLUMN_HEADER: 'ID_CONTROLE_APP'
    },
    spreadsheets: {}
  };

  const spreadsheet = {
    id: spreadsheetId,
    name: spreadsheetName,
    runtime,
    permissions: {
      'controladoria@escritorio-exemplo.local': 'EDIT',
      'colega@escritorio-exemplo.local': 'EDIT',
      'consulta@escritorio-exemplo.local': 'VIEW'
    },
    sheets: [],
    getId() { return this.id; },
    getName() { return this.name; },
    getSheetByName(name) {
      return this.sheets.find((s) => s.getName() === name) || null;
    },
    getSheets() {
      return this.sheets.slice();
    },
    getOwner() {
      return { getEmail: () => 'controladoria@escritorio-exemplo.local' };
    },
    getEditors() {
      return Object.entries(this.permissions)
        .filter(([, perm]) => perm === 'EDIT' || perm === 'OWNER')
        .map(([email]) => ({ getEmail: () => email }));
    }
  };

  const sheet = new MockSheet(spreadsheet, sheetName);
  spreadsheet.sheets.push(sheet);
  runtime.spreadsheets[spreadsheetId] = spreadsheet;

  function loadInitialData(referenceDateIso) {
    spreadsheet.sheets = [sheet];
    delete runtime.properties['LISTAS_' + spreadsheetId + '_0'];
    sheet.rows = [];
    sheet._writeLog = [];

    const headers = includeIds ? SAMPLE_HEADERS.slice() : SAMPLE_HEADERS.slice(0, 16);
    sheet.rows.push(headers.map((h) => makeCell(h)));

    const sampleRows = buildSampleSheetRows(referenceDateIso);
    for (const item of sampleRows) {
      const vals = includeIds ? item.values.slice() : item.values.slice(0, 16);
      const rowCells = vals.map((v, idx) => {
        const col1 = idx + 1;
        const meta = (item.cellMeta && item.cellMeta[col1]) ? { ...item.cellMeta[col1] } : {};
        if (SAMPLE_DROPDOWN_VALIDATIONS[col1]) {
          meta.validation = createValidationRule(SAMPLE_DROPDOWN_VALIDATIONS[col1]);
        }
        return makeCell(v, meta);
      });
      sheet.rows.push(rowCells);
    }
  }

  loadInitialData(options.referenceDateIso);

  const DriveAppPermission = {
    OWNER: 'OWNER',
    EDIT: 'EDIT',
    VIEW: 'VIEW',
    COMMENT: 'COMMENT',
    NONE: 'NONE',
    ORGANIZER: 'ORGANIZER',
    FILE_ORGANIZER: 'FILE_ORGANIZER'
  };

  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    Intl,
    parseInt,
    parseFloat,
    isNaN,
    SpreadsheetApp: {
      DataValidationCriteria: {
        VALUE_IN_LIST: 'VALUE_IN_LIST',
        VALUE_IN_RANGE: 'VALUE_IN_RANGE'
      },
      ProtectionType: {
        SHEET: 'SHEET',
        RANGE: 'RANGE'
      },
      openById(id) {
        const ss = runtime.spreadsheets[id];
        if (!ss) throw new Error('Spreadsheet not found: ' + id);
        const perm = ss.permissions[runtime.currentUser.email] || 'NONE';
        if (perm === 'NONE') {
          throw new Error('You do not have permission to access the requested document.');
        }
        return ss;
      },
      getActiveSpreadsheet() {
        return runtime.spreadsheets[spreadsheetId];
      },
      flush() {}
    },
    Sheets: { Spreadsheets: {
      batchUpdate(batch, id) {
        if (id !== spreadsheetId) throw new Error('Planilha inválida.');
        sheet._assertWritable();
        for (const req of batch.requests) {
          if (req.addSheet) {
            const props = req.addSheet.properties;
            const log = new MockSheet(spreadsheet, props.title);
            log.id = props.sheetId;
            spreadsheet.sheets.push(log);
            continue;
          }
          if (req.appendDimension) continue;
          const write = req.updateCells || req.appendCells;
          const start = write.start || write;
          const target = spreadsheet.sheets.find(s => s.getSheetId() === start.sheetId);
          const first = req.appendCells ? target.rows.length : start.rowIndex;
          write.rows.forEach((row, ri) => row.values.forEach((spec, ci) => {
            const range = target.getRange(first + ri + 1, (start.columnIndex || 0) + ci + 1);
            const entered = spec.userEnteredValue || {};
            const value = entered.numberValue === undefined ? entered.stringValue || '' :
              new Date((entered.numberValue - 25569) * 86400000 + 12 * 3600000);
            range.setValue(value);
            if (write.fields.includes('dataValidation')) {
              const cell = target._getCell(range.startRow, range.startCol);
              cell.validation = spec.dataValidation ? createValidationRule(spec.dataValidation.condition.values.map(v => v.userEnteredValue)) : null;
            }
          }));
        }
      }
    } },
    DriveApp: {
      Permission: DriveAppPermission,
      getFileById(id) {
        const ss = runtime.spreadsheets[id];
        if (!ss) throw new Error('File not found: ' + id);
        return {
          getAccess(user) {
            const email = typeof user === 'string' ? user : (user && user.getEmail ? user.getEmail() : '');
            return ss.permissions[email] || DriveAppPermission.NONE;
          }
        };
      }
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key) {
            return Object.prototype.hasOwnProperty.call(runtime.properties, key) ? runtime.properties[key] : null;
          },
          setProperties(map) {
            Object.assign(runtime.properties, map);
          }
        };
      }
    },
    Session: {
      getActiveUser() {
        return { getEmail: () => runtime.currentUser.email };
      },
      getEffectiveUser() {
        return { getEmail: () => runtime.currentUser.email };
      }
    },
    LockService: {
      getDocumentLock() {
        return {
          tryLock() { return true; },
          waitLock() {},
          releaseLock() {}
        };
      },
      getScriptLock() {
        return {
          tryLock() { return true; },
          waitLock() {},
          releaseLock() {}
        };
      }
    },
    Utilities: {
      formatDate(dateObj, timeZone, pattern) {
        return formatDateWithPattern(dateObj, timeZone, pattern);
      },
      getUuid() {
        return crypto.randomUUID();
      }
    },
    HtmlService: {
      createTemplateFromFile() {
        return { evaluate() { return { setTitle() { return this; }, addMetaTag() { return this; } }; } };
      },
      createHtmlOutputFromFile(filename) {
        const htmlPath = path.join(SRC_DIR, filename.endsWith('.html') ? filename : `${filename}.html`);
        return { getContent: () => fs.readFileSync(htmlPath, 'utf8') };
      }
    }
  };

  vm.createContext(sandbox);

  const gsFiles = ['Config.gs', 'Domain.gs', 'SheetRepository.gs', 'Management.gs', 'Code.gs'];
  for (const file of gsFiles) {
    const code = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
  }

  function setActiveUser(email, perm) {
    runtime.currentUser.email = email;
    if (perm) {
      spreadsheet.permissions[email] = perm;
    }
  }

  function reorderDataRowsReverse() {
    if (sheet.rows.length <= 2) return;
    const header = sheet.rows[0];
    const data = sheet.rows.slice(1).reverse();
    sheet.rows = [header, ...data];
  }

  function simulateDirectSheetEditByColleague(recordId, colIndex1Based, newValue) {
    const headerRow = sheet.rows[0];
    let idCol = -1;
    for (let c = 16; c < headerRow.length; c++) {
      if (String(headerRow[c].value).trim().toUpperCase() === 'ID_CONTROLE_APP') {
        idCol = c;
        break;
      }
    }
    if (idCol === -1) return null;

    for (let r = 1; r < sheet.rows.length; r++) {
      if (String(sheet.rows[r][idCol].value).trim() === recordId) {
        sheet.rows[r][colIndex1Based - 1].value = newValue;
        sheet.rows[r][9].value = formatDateWithPattern(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm');
        return r + 1;
      }
    }
    return null;
  }

  return {
    api: sandbox,
    sheet,
    spreadsheet,
    runtime,
    setActiveUser,
    loadInitialData,
    reorderDataRowsReverse,
    simulateDirectSheetEditByColleague
  };
}

module.exports = {
  createGasRuntime,
  SRC_DIR
};
