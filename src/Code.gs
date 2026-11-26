/**
 * Code.gs
 * Entrypoint do Web App (Google Apps Script) e funções expostas via google.script.run.
 */

function doGet() {
  var template = HtmlService.createTemplateFromFile('Index');
  return template
    .evaluate()
    .setTitle('Agenda de Prazos — Controladoria')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Carrega os dados da agenda, opções de filtros e permissões do usuário atual.
 * Operação 100% somente leitura.
 */
function apiGetAgendaData() {
  try {
    return fetchAgendaSnapshot();
  } catch (err) {
    return {
      ok: false,
      code: err.appCode || 'LOAD_ERROR',
      message: err.message || 'Erro inesperado ao carregar a agenda.'
    };
  }
}

/**
 * Grava alterações em um registro específico (validando permissão, ID estável e conflito).
 */
function apiSaveRecord(payload) {
  try {
    return saveRecordUpdate(payload);
  } catch (err) {
    return {
      ok: false,
      code: err.appCode || 'SAVE_ERROR',
      message: err.message || 'Erro inesperado ao salvar as alterações na planilha.'
    };
  }
}

/**
 * Inicializa a coluna técnica ID_CONTROLE_APP para linhas que ainda não tenham ID estável.
 * Disponível apenas para editores.
 */
function apiEnsureStableIds() {
  try {
    return ensureStableIdsInSheet();
  } catch (err) {
    return {
      ok: false,
      code: err.appCode || 'INIT_IDS_ERROR',
      message: err.message || 'Erro ao inicializar identificadores estáveis.'
    };
  }
}

/**
 * Atalho executável diretamente no editor do Apps Script para preparar a cópia de trabalho.
 */
function garantirIdsNaPlanilha() {
  return ensureStableIdsInSheet();
}
