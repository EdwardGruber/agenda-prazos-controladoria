'use strict';

const assert = require('assert');
const http = require('http');
const { createGasRuntime } = require('../local-demo/gas-runtime');
const { addDaysIso } = require('../sample-data/mock-records');

const FIXED_TODAY = '2026-11-26';

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function findById(records, id) {
  return records.find((r) => r.id === id);
}

/* =========================================================================
 * 1. Visão inicial (Atenção do dia), navegação de data e juntada com Protocolado = Não
 * ========================================================================= */
test('1. Visão inicial mostra fatais de hoje, juntadas de hoje (inclusive Protocolado=Não) e pendentes de conferência', () => {
  const env = createGasRuntime({ referenceDateIso: FIXED_TODAY });
  const snap = env.api.apiGetAgendaData();

  assert.strictEqual(snap.ok, true);
  assert.strictEqual(env.sheet._writeLog.length, 0, 'Abrir a agenda não pode escrever nenhuma célula na planilha');

  // Garante que o retorno do servidor é 100% serializável para google.script.run (sem objetos Date crus)
  const serializedRoundTrip = JSON.parse(JSON.stringify(snap));
  assert.strictEqual(serializedRoundTrip.records.length, snap.records.length);

  const classified = snap.records.map((rec) => ({
    rec,
    cls: env.api.classifyRecordForDate(rec, FIXED_TODAY)
  }));

  const attentionIds = Array.from(classified.filter((x) => x.cls.inAttentionView).map((x) => x.rec.id)).sort();
  // Esperados em FIXED_TODAY:
  // - PRZ-DEMO-0001: fatal hoje (Protocolado=Não)
  // - PRZ-DEMO-0002: juntada hoje com Protocolado=Não (mesmo processo do 0001)
  // - PRZ-DEMO-0003: fatal ontem com Protocolado=Não (Pendente de conferência)
  // - PRZ-DEMO-0004: fatal -3d com Protocolado=Não (Pendente de conferência)
  // - PRZ-DEMO-0005: fatal hoje com datas vazias nas outras colunas
  // - PRZ-DEMO-0006: fatal hoje já Protocolado=Sim
  // Excluídos de hoje:
  // - PRZ-DEMO-0007: fatal -2d mas Protocolado=Sim
  // - PRZ-DEMO-0008: amanhã
  // - PRZ-DEMO-0009: sem datas
  // - PRZ-DEMO-0010: futuro (+3/+7)
  assert.deepStrictEqual(attentionIds, [
    'PRZ-DEMO-0001',
    'PRZ-DEMO-0002',
    'PRZ-DEMO-0003',
    'PRZ-DEMO-0004',
    'PRZ-DEMO-0005',
    'PRZ-DEMO-0006'
  ]);

  const juntadaNao = classified.find((x) => x.rec.id === 'PRZ-DEMO-0002');
  assert.strictEqual(juntadaNao.rec.protocolado, 'Não');
  assert.strictEqual(juntadaNao.cls.isJuntadaOnDate, true);
  assert.strictEqual(juntadaNao.cls.isPendingReview, false);

  const pendente = classified.find((x) => x.rec.id === 'PRZ-DEMO-0003');
  assert.strictEqual(pendente.cls.isPendingReview, true);
  assert.ok(pendente.cls.tags.includes('Pendente de conferência'));

  // Navegação para amanhã: inclui PRZ-DEMO-0008 e promove fatais de hoje ainda Não protocolados a pendentes
  const tomorrow = addDaysIso(FIXED_TODAY, 1);
  const clsTomorrow0008 = env.api.classifyRecordForDate(findById(snap.records, 'PRZ-DEMO-0008'), tomorrow);
  assert.strictEqual(clsTomorrow0008.isFatalOnDate, true);
  assert.strictEqual(clsTomorrow0008.isJuntadaOnDate, true);

  const clsTomorrow0006 = env.api.classifyRecordForDate(findById(snap.records, 'PRZ-DEMO-0006'), tomorrow);
  assert.strictEqual(clsTomorrow0006.inAttentionView, false, 'Fatal anterior já Protocolado=Sim não entra em pendentes');
});

/* =========================================================================
 * 2. Dois prazos do mesmo processo (edição isolada sem afetar o outro prazo)
 * ========================================================================= */
test('2. Dois prazos do mesmo processo são independentes na listagem e na edição', () => {
  const env = createGasRuntime({ referenceDateIso: FIXED_TODAY });
  const snap = env.api.apiGetAgendaData();

  const sameProcess = snap.records.filter((r) => r.numeroProcesso === '0004821-15.2025.8.26.0100');
  assert.strictEqual(sameProcess.length, 2);
  assert.notStrictEqual(sameProcess[0].id, sameProcess[1].id);

  const prazo1Before = findById(snap.records, 'PRZ-DEMO-0001');
  const prazo2Before = findById(snap.records, 'PRZ-DEMO-0002');

  const saveRes = env.api.apiSaveRecord({
    recordId: prazo2Before.id,
    expectedVersion: prazo2Before.version,
    changes: {
      proximosPassos: 'Procuração e guia DARE conferidas, pronto para juntada',
      protocolado: 'Sim',
      observacaoP: 'Juntada realizada via e-SAJ'
    }
  });

  assert.strictEqual(saveRes.ok, true);
  assert.strictEqual(saveRes.record.id, 'PRZ-DEMO-0002');
  assert.strictEqual(saveRes.record.protocolado, 'Sim');
  assert.strictEqual(saveRes.record.observacaoP, 'Juntada realizada via e-SAJ');
  assert.strictEqual(saveRes.record.observacaoM, prazo2Before.observacaoM, 'Observação (M) deve permanecer independente');

  // Verifica que o PRAZO 1 do mesmo processo não sofreu nenhuma alteração
  const snapAfter = env.api.apiGetAgendaData();
  const prazo1After = findById(snapAfter.records, 'PRZ-DEMO-0001');
  assert.strictEqual(prazo1After.proximosPassos, prazo1Before.proximosPassos);
  assert.strictEqual(prazo1After.protocolado, 'Não');
  assert.strictEqual(prazo1After.ultimaAtualizacao, prazo1Before.ultimaAtualizacao);
});

/* =========================================================================
 * 3. Linha reordenada na planilha (rastreamento via ID_CONTROLE_APP)
 * ========================================================================= */
test('3. Linha reordenada na planilha após abertura ainda grava na linha correta pelo ID estável', () => {
  const env = createGasRuntime({ referenceDateIso: FIXED_TODAY });
  const snapBefore = env.api.apiGetAgendaData();

  const targetBefore = findById(snapBefore.records, 'PRZ-DEMO-0001');
  assert.strictEqual(targetBefore.rowNumber, 2, 'Inicialmente PRZ-DEMO-0001 está na linha 2');

  // Reordena fisicamente todas as linhas da planilha (inverte a ordem)
  env.reorderDataRowsReverse();

  // Salva usando o ID estável carregado ANTES da reordenação
  const saveRes = env.api.apiSaveRecord({
    recordId: targetBefore.id,
    expectedVersion: targetBefore.version,
    changes: {
      priorizacao: 'Alta',
      observacaoM: 'Atualizado após reordenação da planilha'
    }
  });

  assert.strictEqual(saveRes.ok, true);
  assert.strictEqual(saveRes.record.id, 'PRZ-DEMO-0001');
  assert.strictEqual(saveRes.record.rowNumber, 11, 'Após inversão, PRZ-DEMO-0001 deve estar na linha 11');
  assert.strictEqual(saveRes.record.priorizacao, 'Alta');
  assert.strictEqual(saveRes.record.observacaoM, 'Atualizado após reordenação da planilha');

  // Garante que a nova linha 2 (PRZ-DEMO-0010) não foi tocada!
  const snapAfter = env.api.apiGetAgendaData();
  const row2Record = snapAfter.records.find((r) => r.rowNumber === 2);
  assert.strictEqual(row2Record.id, 'PRZ-DEMO-0010');
  assert.strictEqual(row2Record.priorizacao, 'Baixa');
});

/* =========================================================================
 * 4. Datas vazias, parsing de datas BR/Date, preservação das 4 colunas de data
 * ========================================================================= */
test('4. Datas vazias permanecem vazias sem dedução e formatos BR (com/sem zero) são aceitos', () => {
  const env = createGasRuntime({ referenceDateIso: FIXED_TODAY });
  const snap = env.api.apiGetAgendaData();

  const rec0005 = findById(snap.records, 'PRZ-DEMO-0005');
  assert.strictEqual(rec0005.fimDoPrazo.display, '');
  assert.strictEqual(rec0005.fimDoPrazo.iso, null);
  assert.strictEqual(rec0005.prazoLimiteJuntada.display, '');
  assert.strictEqual(rec0005.dataFatal.iso, FIXED_TODAY);
  assert.strictEqual(rec0005.dataJuntada.display, '');
  assert.strictEqual(rec0005.dataJuntada.iso, null);

  const rec0009 = findById(snap.records, 'PRZ-DEMO-0009');
  assert.strictEqual(rec0009.fimDoPrazo.isEmpty, true);
  assert.strictEqual(rec0009.prazoLimiteJuntada.isEmpty, true);
  assert.strictEqual(rec0009.dataFatal.isEmpty, true);
  assert.strictEqual(rec0009.dataJuntada.isEmpty, true);

  // Testes diretos de parseSheetDate
  const dSingle = env.api.parseSheetDate('5/3/2026', '5/3/2026', 'America/Sao_Paulo');
  assert.strictEqual(dSingle.iso, '2026-03-05');
  assert.strictEqual(dSingle.display, '05/03/2026');
  assert.strictEqual(dSingle.valid, true);

  const dShortYear = env.api.parseSheetDate('9/11/26', '9/11/26', 'America/Sao_Paulo');
  assert.strictEqual(dShortYear.iso, '2026-11-09');
  assert.strictEqual(dShortYear.display, '09/11/2026');

  const dInvalid = env.api.parseSheetDate('31/02/2026', '31/02/2026', 'America/Sao_Paulo');
  assert.strictEqual(dInvalid.valid, false);
  assert.strictEqual(dInvalid.iso, null);
  assert.strictEqual(dInvalid.display, '31/02/2026');
});

/* =========================================================================
 * 5. Preservação de zeros à esquerda, busca tolerante a pontuação e formato atípico
 * ========================================================================= */
test('5. Número do processo preserva zeros à esquerda e busca funciona com/sem pontuação e formatos atípicos', () => {
  const env = createGasRuntime({ referenceDateIso: FIXED_TODAY });
  const snap = env.api.apiGetAgendaData();

  const recZeros = findById(snap.records, 'PRZ-DEMO-0005');
  assert.strictEqual(recZeros.numeroProcesso, '0000718-09.2025.8.26.0002');
  assert.strictEqual(env.api.matchesSearchQuery(recZeros, '00007180920258260002'), true);
  assert.strictEqual(env.api.matchesSearchQuery(recZeros, '0000718-09'), true);
  assert.strictEqual(env.api.matchesSearchQuery(recZeros, 'ana paula'), true);

  const recAtypical = findById(snap.records, 'PRZ-DEMO-0009');
  assert.strictEqual(recAtypical.numeroProcesso, 'PROC-ADM-2025/0088-B');
  assert.strictEqual(env.api.matchesSearchQuery(recAtypical, 'procadm20250088b'), true);
  assert.strictEqual(env.api.matchesSearchQuery(recAtypical, 'joao ricardo'), true);
});

/* =========================================================================
 * 6. Gravação seletiva preserva Coluna A ("3"/"-"), fórmulas, formatação, listas e Obs M/P
 * ========================================================================= */
test('6. Gravação seletiva preserva coluna A, fórmulas, formatação, validações e atualiza Última atualização somente ao salvar', () => {
  const env = createGasRuntime({ referenceDateIso: FIXED_TODAY });
  const snap = env.api.apiGetAgendaData();
  const rec = findById(snap.records, 'PRZ-DEMO-0001');

  assert.strictEqual(rec.colA, '-');
  assert.strictEqual(env.sheet._getCell(2, 2).formula, '=UPPER("tjsp")');
  assert.strictEqual(env.sheet._getCell(2, 8).format.background, '#fee2e2');
  assert.ok(env.sheet._getCell(2, 8).validation, 'Validação de lista suspensa em Priorização');

  env.sheet._writeLog = [];
  const res = env.api.apiSaveRecord({
    recordId: rec.id,
    expectedVersion: rec.version,
    changes: {
      priorizacao: 'Alta',
      observacaoM: 'Nova observação M'
    }
  });

  assert.strictEqual(res.ok, true);

  // Apenas 3 células devem ter sido gravadas: H (8), M (13) e J (10 - Última atualização)
  const writtenCols = env.sheet._writeLog.map((w) => w.col).sort((a, b) => a - b);
  assert.deepStrictEqual(writtenCols, [8, 10, 13]);

  // Verifica preservação
  assert.strictEqual(env.sheet._getCell(2, 1).value, '-', 'Coluna A preservada');
  assert.strictEqual(env.sheet._getCell(2, 2).formula, '=UPPER("tjsp")', 'Fórmula na coluna B preservada');
  assert.strictEqual(env.sheet._getCell(2, 8).format.background, '#fee2e2', 'Formatação preservada na célula editada');
  assert.ok(env.sheet._getCell(2, 8).validation, 'Lista suspensa preservada na célula editada');
  assert.strictEqual(res.record.observacaoP, rec.observacaoP, 'Observação (P) inalterada');
  assert.strictEqual(res.record.protocolado, 'Não', 'Protocolado não muda sem ação explícita');
  assert.notStrictEqual(res.record.ultimaAtualizacao, rec.ultimaAtualizacao, 'Última atualização renovada');
});

/* =========================================================================
 * 7. Conflito de edição simultânea (duas pessoas editando o mesmo registro)
 * ========================================================================= */
test('7. Duas pessoas editando o mesmo registro gera conflito na segunda gravação e permite recarregar', () => {
  const env = createGasRuntime({ referenceDateIso: FIXED_TODAY });

  // Pessoa A carrega
  env.setActiveUser('controladoria@escritorio-exemplo.local', 'EDIT');
  const snapA = env.api.apiGetAgendaData();
  const recA = findById(snapA.records, 'PRZ-DEMO-0003');

  // Pessoa B carrega ao mesmo tempo (mesma versão)
  env.setActiveUser('colega@escritorio-exemplo.local', 'EDIT');
  const snapB = env.api.apiGetAgendaData();
  const recB = findById(snapB.records, 'PRZ-DEMO-0003');
  assert.strictEqual(recA.version, recB.version);

  // Pessoa A salva primeiro
  env.setActiveUser('controladoria@escritorio-exemplo.local', 'EDIT');
  const resA = env.api.apiSaveRecord({
    recordId: recA.id,
    expectedVersion: recA.version,
    changes: {
      proximosPassos: 'Recibo localizado e conferido pela Pessoa A',
      protocolado: 'Sim'
    }
  });
  assert.strictEqual(resA.ok, true);

  // Pessoa B tenta salvar com a versão antiga -> DEVE DAR CONFLITO
  env.setActiveUser('colega@escritorio-exemplo.local', 'EDIT');
  const resB = env.api.apiSaveRecord({
    recordId: recB.id,
    expectedVersion: recB.version,
    changes: {
      proximosPassos: 'Alteração desatualizada da Pessoa B'
    }
  });

  assert.strictEqual(resB.ok, false);
  assert.strictEqual(resB.code, 'CONFLICT');
  assert.ok(resB.currentRecord, 'Servidor devolve o registro atual para exibição do conflito');
  assert.strictEqual(resB.currentRecord.protocolado, 'Sim');
  assert.strictEqual(resB.currentRecord.proximosPassos, 'Recibo localizado e conferido pela Pessoa A');

  // Pessoa B recarrega os dados e salva com a nova versão
  const snapBReloaded = env.api.apiGetAgendaData();
  const recBReloaded = findById(snapBReloaded.records, 'PRZ-DEMO-0003');
  const resBAfterReload = env.api.apiSaveRecord({
    recordId: recBReloaded.id,
    expectedVersion: recBReloaded.version,
    changes: {
      observacaoP: 'Complemento adicionado pela Pessoa B após recarregar'
    }
  });
  assert.strictEqual(resBAfterReload.ok, true);
  assert.strictEqual(resBAfterReload.record.protocolado, 'Sim');
  assert.strictEqual(resBAfterReload.record.observacaoP, 'Complemento adicionado pela Pessoa B após recarregar');
});

/* =========================================================================
 * 8. Usuário somente leitura consegue consultar e servidor bloqueia gravação
 * ========================================================================= */
test('8. Usuário com acesso de leitura consulta normalmente e servidor impede qualquer gravação', () => {
  const env = createGasRuntime({ referenceDateIso: FIXED_TODAY });
  env.setActiveUser('consulta@escritorio-exemplo.local', 'VIEW');

  const snap = env.api.apiGetAgendaData();
  assert.strictEqual(snap.ok, true);
  assert.strictEqual(snap.records.length, 10);
  assert.strictEqual(snap.userAccess.canEdit, false);
  assert.strictEqual(snap.userAccess.role, 'VIEWER');

  const rec = findById(snap.records, 'PRZ-DEMO-0001');
  env.sheet._writeLog = [];

  const saveAttempt = env.api.apiSaveRecord({
    recordId: rec.id,
    expectedVersion: rec.version,
    changes: {
      protocolado: 'Sim',
      proximosPassos: 'Tentativa indevida de usuário somente leitura'
    }
  });

  assert.strictEqual(saveAttempt.ok, false);
  assert.strictEqual(saveAttempt.code, 'FORBIDDEN');
  assert.strictEqual(env.sheet._writeLog.length, 0, 'Nenhuma célula pode ser gravada por usuário VIEWER');

  const initIdsAttempt = env.api.apiEnsureStableIds();
  assert.strictEqual(initIdsAttempt.ok, false);
  assert.strictEqual(initIdsAttempt.code, 'FORBIDDEN');
});

/* =========================================================================
 * 9. Planilha sem coluna ID_CONTROLE_APP ainda funciona para leitura e inicialização segura
 * ========================================================================= */
test('9. Planilha nova sem coluna ID_CONTROLE_APP permite leitura por VIEWER e inicialização por EDITOR sem alterar A..P', () => {
  const env = createGasRuntime({ referenceDateIso: FIXED_TODAY, includeIds: false });

  // Leitor abre planilha sem IDs sem erro de permissão
  env.setActiveUser('consulta@escritorio-exemplo.local', 'VIEW');
  const viewerSnap = env.api.apiGetAgendaData();
  assert.strictEqual(viewerSnap.ok, true);
  assert.strictEqual(viewerSnap.meta.missingIdCount, 10);
  assert.strictEqual(env.sheet._writeLog.length, 0);

  // Editor inicializa IDs
  env.setActiveUser('controladoria@escritorio-exemplo.local', 'EDIT');
  const initRes = env.api.apiEnsureStableIds();
  assert.strictEqual(initRes.ok, true);
  assert.strictEqual(initRes.createdCount, 10);
  assert.strictEqual(initRes.idColIndex, 17);

  // Verifica que nenhuma coluna de A..P (1..16) foi tocada
  const touchedAtoP = env.sheet._writeLog.filter((w) => w.col <= 16);
  assert.strictEqual(touchedAtoP.length, 0, 'Inicializar IDs não pode tocar nas colunas A..P nem em Última atualização');

  const afterSnap = env.api.apiGetAgendaData();
  assert.strictEqual(afterSnap.meta.missingIdCount, 0);
  const uniqueIds = new Set(afterSnap.records.map((r) => r.id));
  assert.strictEqual(uniqueIds.size, 10);
});

/* =========================================================================
 * 10. Teste HTTP ponta a ponta do servidor de demonstração local
 * ========================================================================= */
test('10. Servidor demo local responde HTML com banner visível e endpoints RPC funcionais', async () => {
  const { server } = require('../local-demo/server');

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  function httpReq(method, urlPath, body) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: urlPath,
          method,
          headers: payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        }
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  try {
    const htmlRes = await httpReq('GET', '/');
    assert.strictEqual(htmlRes.status, 200);
    assert.ok(htmlRes.body.includes('Modo Demonstração Local'));
    assert.ok(htmlRes.body.includes('Agenda de Prazos — Controladoria'));

    const loadRes = await httpReq('POST', '/api/rpc', { method: 'apiGetAgendaData' });
    const loadJson = JSON.parse(loadRes.body);
    assert.strictEqual(loadJson.ok, true);
    assert.strictEqual(loadJson.meta.isDemo, true);
    assert.strictEqual(loadJson.records.length, 10);

    // Alterna para VIEWER e garante bloqueio no servidor HTTP
    await httpReq('POST', '/api/demo/set-role', { role: 'VIEWER' });
    const viewerSave = await httpReq('POST', '/api/rpc', {
      method: 'apiSaveRecord',
      payload: {
        recordId: loadJson.records[0].id,
        expectedVersion: loadJson.records[0].version,
        changes: { protocolado: 'Sim' }
      }
    });
    const viewerSaveJson = JSON.parse(viewerSave.body);
    assert.strictEqual(viewerSaveJson.ok, false);
    assert.strictEqual(viewerSaveJson.code, 'FORBIDDEN');

    // Restaura perfil EDITOR e reseta demo
    await httpReq('POST', '/api/demo/set-role', { role: 'EDITOR' });
    await httpReq('POST', '/api/demo/reset', {});
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

/* =========================================================================
 * Runner
 * ========================================================================= */
test('Cadastro, repetição do pedido e histórico por usuário', () => {
  const env = createGasRuntime();
  const id = 'PRZ-' + require('node:crypto').randomUUID();
  const request = { recordId: id, changes: { numeroProcesso: '000015', tribunal: 'TJ', tipo: 'Petição', dataFatal: '2027-01-19', proximosPassos: 'Conferir\nProtocolar' } };
  const first = env.api.apiCreateRecord(request).record;
  assert.equal(first.numeroProcesso, '000015');
  assert.equal(first.dataFatal.iso, '2027-01-19');
  assert.equal(first.history.length, 1);
  assert.equal(first.history[0].email, env.runtime.currentUser.email);
  env.api.apiCreateRecord(request);
  env.setActiveUser('colega@escritorio-exemplo.local', 'EDIT');
  const saved = env.api.apiSaveRecord({ recordId: id, expectedVersion: first.version, changes: { cliente: 'Cliente B', dataFatal: '', proxINVALID: 'x' } });
  assert.equal(saved.ok, false);
  const updated = env.api.apiSaveRecord({ recordId: id, expectedVersion: first.version, changes: { cliente: 'Cliente B', dataFatal: '', proximosPassos: 'Redigir peça' } });
  assert.equal(updated.ok, true);
  const records = env.api.apiGetAgendaData().records.filter(r => r.id === id);
  assert.equal(records.length, 1);
  assert.equal(records[0].dataFatal.iso, null);
  assert.equal(records[0].proximosPassos, 'Redigir peça');
  assert.equal(records[0].history.length, 2);
  assert.equal(records[0].history[1].email, 'colega@escritorio-exemplo.local');
  assert.equal(records[0].history[1].action, 'Alteração');
});

test('Opções excluídas permanecem nos registros antigos e leitores não alteram listas ou cadastram', () => {
  const env = createGasRuntime();
  const snap = env.api.apiGetAgendaData();
  for (const key of ['responsavel', 'priorizacao']) {
    const original = snap.records.find(r => r[key])[key];
    env.api.apiChangeOption({ key, name: original, action: 'remove' });
    env.api.apiChangeOption({ key, name: 'Nova opção', action: 'add' });
    const after = env.api.apiGetAgendaData();
    assert.ok(after.managedOptions[key].includes('Nova opção'));
    assert.ok(!after.managedOptions[key].includes(original));
    assert.ok(after.records.some(r => r[key] === original));
  }
  env.setActiveUser('consulta@escritorio-exemplo.local', 'VIEW');
  assert.throws(() => env.api.apiChangeOption({ key: 'responsavel', name: 'Teste', action: 'add' }), /editores/);
  assert.throws(() => env.api.apiCreateRecord({}), /editores/);
});

// Extrai funções nomeadas de src/AppScript.html para testar a lógica da tela sem navegador.
function loadFrontFunctions(names) {
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'AppScript.html'), 'utf8');
  const bodies = names.map((name) => {
    const start = source.indexOf('function ' + name + '(');
    assert.ok(start >= 0, 'Função ' + name + ' não encontrada em AppScript.html');
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
      if (source[i] === '{') depth++;
      if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('Função ' + name + ' sem fechamento');
  });
  const sandbox = {};
  require('vm').runInNewContext(bodies.join('\n') + '\nthis.fns = {' + names.join(',') + '};', sandbox);
  return sandbox.fns;
}

test('Prazo vencido com Protocolado em branco fica pendente na tela e no servidor', () => {
  const env = createGasRuntime({ referenceDateIso: FIXED_TODAY });
  const front = loadFrontFunctions(['normalizeText', 'isProtocoladoNao', 'classifyForDate']);
  const yesterday = addDaysIso(FIXED_TODAY, -1);
  const expected = { 'Não': true, '': true, '  ': true, 'Sim': false, 'N/A': false };
  for (const [protocolado, pending] of Object.entries(expected)) {
    const rec = { dataFatal: { iso: yesterday }, dataJuntada: { iso: null }, protocolado };
    assert.strictEqual(env.api.classifyRecordForDate(rec, FIXED_TODAY).isPendingReview, pending, 'servidor: "' + protocolado + '"');
    assert.strictEqual(front.classifyForDate(rec, FIXED_TODAY).isPendingReview, pending, 'tela: "' + protocolado + '"');
  }
});

test('Linha sem cliente ou processo continua na agenda com aviso e fica fora dos gráficos', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'AppScript.html'), 'utf8');
  assert.ok(!/state\.records\s*=\s*\(res\.records[^;]*\.filter/.test(source), 'A carga não pode descartar registros');
  const front = loadFrontFunctions(['isCompleteRecord', 'renderAttentionBadgesHtml']);
  const fatalToday = { isPendingReview: false, isFatalOnDate: true, isJuntadaOnDate: false };
  const semCliente = front.renderAttentionBadgesHtml(fatalToday, { numeroProcesso: '0001', cliente: '' });
  assert.ok(semCliente.includes('Cadastro incompleto') && semCliente.includes('Fatal no dia'));
  const completo = front.renderAttentionBadgesHtml(fatalToday, { numeroProcesso: '0001', cliente: 'Banco X' });
  assert.ok(!completo.includes('Cadastro incompleto'));
  assert.strictEqual(front.isCompleteRecord({ numeroProcesso: '0001', cliente: ' ' }), false);
});

(async function main() {
  let passed = 0;
  let failed = 0;
  console.log('\nExecutando suíte de testes — Agenda de Prazos (Controladoria)\n');

  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  [PASS] ${t.name}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${t.name}`);
      console.error(`         ${err.stack || err.message}`);
      failed++;
    }
  }

  console.log(`\nResultado: ${passed} passaram, ${failed} falharam (total: ${tests.length}).\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
