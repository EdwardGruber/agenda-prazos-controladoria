/**
 * Config.gs
 * Configurações centralizadas da Agenda de Prazos da Controladoria.
 *
 * Para configurar a planilha real sem colocar IDs no código/Git:
 * 1. No editor do Apps Script, vá em Configurações do Projeto > Propriedades do script
 *    OU execute a função configurarPlanilhaControladoria(spreadsheetId, sheetName).
 * 2. Propriedades suportadas:
 *    - SPREADSHEET_ID: ID da planilha Google (opcional se o script estiver vinculado à própria planilha)
 *    - SHEET_NAME: Nome exato da aba de origem (ex.: "Prazos", "Controladoria")
 *    - TIMEZONE: Padrão "America/Sao_Paulo"
 *    - ID_COLUMN_HEADER: Padrão "ID_CONTROLE_APP"
 */

var AGENDA_COLUMNS = Object.freeze({
  COL_A: 1,                  // A: Cabeçalho "3" (preservar valor original)
  TRIBUNAL: 2,               // B: Tribunal
  FIM_DO_PRAZO: 3,           // C: Fim do Prazo
  PRAZO_LIMITE_JUNTADA: 4,   // D: Prazo limite para juntada
  NUMERO_PROCESSO: 5,        // E: Número do Processo (texto, preservar zeros à esquerda)
  CLIENTE: 6,                // F: Cliente
  PROXIMOS_PASSOS: 7,        // G: Próximos passos (editável)
  PRIORIZACAO: 8,            // H: Priorização (editável)
  TIPO: 9,                   // I: Tipo
  ULTIMA_ATUALIZACAO: 10,    // J: Última atualização (atualizado somente ao salvar via app)
  DATA_FATAL: 11,            // K: Data fatal
  DATA_JUNTADA: 12,          // L: Data da juntada
  OBSERVACAO_M: 13,          // M: Observação (M) (editável)
  PROTOCOLADO: 14,           // N: Protocolado (editável por ação explícita)
  RESPONSAVEL: 15,           // O: Responsavel (editável)
  OBSERVACAO_P: 16           // P: Observação (P) (editável)
});

var EDITABLE_FIELD_MAP = Object.freeze({
  proximosPassos: { col: AGENDA_COLUMNS.PROXIMOS_PASSOS, label: 'Próximos passos' },
  responsavel: { col: AGENDA_COLUMNS.RESPONSAVEL, label: 'Responsável' },
  priorizacao: { col: AGENDA_COLUMNS.PRIORIZACAO, label: 'Priorização' },
  observacaoM: { col: AGENDA_COLUMNS.OBSERVACAO_M, label: 'Observação (M)' },
  observacaoP: { col: AGENDA_COLUMNS.OBSERVACAO_P, label: 'Observação (P)' },
  protocolado: { col: AGENDA_COLUMNS.PROTOCOLADO, label: 'Protocolado' }
});

var DEFAULT_OPTIONS = Object.freeze({
  priorizacao: ['Urgente', 'Alta', 'Média', 'Baixa', 'Sem urgência'],
  tipo: ['Prazo fatal', 'Renunciar', 'Não se aplica'],
  protocolado: ['Não', 'Sim']
});

var DEFAULT_TIMEZONE = 'America/Sao_Paulo';
var DEFAULT_ID_HEADER = 'ID_CONTROLE_APP';
var HEADER_ROW_INDEX = 1;
var FIRST_DATA_ROW_INDEX = 2;
var MIN_TECHNICAL_COL_INDEX = 17; // Coluna Q em diante

/**
 * Carrega as configurações das ScriptProperties com valores padrão seguros.
 */
function getAgendaConfig() {
  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = String(props.getProperty('SPREADSHEET_ID') || '').trim();
  var sheetName = String(props.getProperty('SHEET_NAME') || '').trim();
  var timezone = String(props.getProperty('TIMEZONE') || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  var idColumnHeader = String(props.getProperty('ID_COLUMN_HEADER') || DEFAULT_ID_HEADER).trim() || DEFAULT_ID_HEADER;

  return {
    spreadsheetId: spreadsheetId,
    sheetName: sheetName,
    timezone: timezone,
    idColumnHeader: idColumnHeader,
    headerRow: HEADER_ROW_INDEX,
    firstDataRow: FIRST_DATA_ROW_INDEX
  };
}

/**
 * Helper administrativo para configurar a planilha de trabalho via ScriptProperties.
 * Execute uma vez pelo editor do Apps Script (sem salvar IDs reais no Git).
 *
 * @param {string} spreadsheetId ID da cópia de trabalho no Google Planilhas
 * @param {string} sheetName Nome da aba de origem
 */
function configurarPlanilhaControladoria(spreadsheetId, sheetName) {
  var props = PropertiesService.getScriptProperties();
  var updates = {
    TIMEZONE: DEFAULT_TIMEZONE,
    ID_COLUMN_HEADER: DEFAULT_ID_HEADER
  };

  if (spreadsheetId && String(spreadsheetId).trim()) {
    updates.SPREADSHEET_ID = String(spreadsheetId).trim();
  }
  if (sheetName && String(sheetName).trim()) {
    updates.SHEET_NAME = String(sheetName).trim();
  }

  props.setProperties(updates, false);
  return getAgendaConfig();
}
