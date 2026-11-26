'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createGasRuntime, SRC_DIR } = require('./gas-runtime');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

const runtime = createGasRuntime({
  spreadsheetName: 'Agenda Controladoria Bancária (MODO DEMONSTRAÇÃO)',
  sheetName: 'Prazos (Fictícios)'
});

function renderLocalHtml() {
  let html = fs.readFileSync(path.join(SRC_DIR, 'Index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(SRC_DIR, 'Styles.html'), 'utf8');
  const appScript = fs.readFileSync(path.join(SRC_DIR, 'AppScript.html'), 'utf8');

  // Ponte leve que emula google.script.run usando o backend local em /api/rpc
  const localBridgeScript = `
<script>
window.google = {
  script: {
    run: (function () {
      function createRunner(successCb, failureCb) {
        return {
          withSuccessHandler: function (fn) {
            return createRunner(fn, failureCb);
          },
          withFailureHandler: function (fn) {
            return createRunner(successCb, fn);
          },
          apiGetAgendaData: function () {
            invoke('apiGetAgendaData', undefined, successCb, failureCb);
          },
          apiSaveRecord: function (payload) {
            invoke('apiSaveRecord', payload, successCb, failureCb);
          },
          apiEnsureStableIds: function () {
            invoke('apiEnsureStableIds', undefined, successCb, failureCb);
          }
        };
      }
      function invoke(method, payload, successCb, failureCb) {
        fetch('/api/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: method, payload: payload })
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (typeof successCb === 'function') successCb(data);
          })
          .catch(function (err) {
            if (typeof failureCb === 'function') failureCb(err);
          });
      }
      return createRunner(null, null);
    })()
  }
};
</script>`;

  html = html.replace("<?!= include('Styles'); ?>", styles);
  html = html.replace("<?!= include('AppScript'); ?>", localBridgeScript + '\n' + appScript);
  return html;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Payload muito grande'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
      const html = renderLocalHtml();
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(html);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/rpc') {
      const body = await readJsonBody(req);
      const method = body.method;
      const allowed = ['apiGetAgendaData', 'apiSaveRecord', 'apiEnsureStableIds'];

      if (!allowed.includes(method) || typeof runtime.api[method] !== 'function') {
        sendJson(res, 400, { ok: false, code: 'BAD_METHOD', message: 'Método inválido: ' + method });
        return;
      }

      const result = runtime.api[method](body.payload);
      if (method === 'apiGetAgendaData' && result && result.meta) {
        result.meta.isDemo = true;
      }
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/demo/set-role') {
      const body = await readJsonBody(req);
      if (body.role === 'VIEWER') {
        runtime.setActiveUser('consulta@escritorio-exemplo.local', 'VIEW');
      } else {
        runtime.setActiveUser('controladoria@escritorio-exemplo.local', 'EDIT');
      }
      sendJson(res, 200, { ok: true, role: body.role });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/demo/reorder') {
      runtime.reorderDataRowsReverse();
      sendJson(res, 200, {
        ok: true,
        message: 'Linhas da planilha foram invertidas/reordenadas em segundo plano. Agora tente editar um registro para testar o rastreamento por ID estável!'
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/demo/simulate-colleague-edit') {
      const body = await readJsonBody(req);
      const targetId = body.recordId || 'PRZ-DEMO-0001';
      const rowNum = runtime.simulateDirectSheetEditByColleague(
        targetId,
        7, // Coluna G: Próximos passos
        'Atualizado por colega (Lucas) diretamente na planilha às ' + new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      );
      sendJson(res, 200, {
        ok: Boolean(rowNum),
        message: rowNum
          ? `Edição simultânea simulada no registro ${targetId} (Proc. 0004821-15.2025.8.26.0100, linha ${rowNum}). Abra esse registro e tente salvar sem atualizar para ver o alerta de conflito.`
          : 'Registro não localizado para simulação.'
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/demo/reset') {
      runtime.loadInitialData();
      sendJson(res, 200, { ok: true });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Não encontrado');
  } catch (err) {
    sendJson(res, 500, { ok: false, code: 'SERVER_ERROR', message: err.message });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('==============================================================');
    console.log('  Agenda de Prazos — Controladoria (MODO DEMONSTRAÇÃO LOCAL)');
    console.log(`  Acesse no navegador: http://${HOST}:${PORT}`);
    console.log('  Dados 100% fictícios em memória. Ctrl+C para encerrar.');
    console.log('==============================================================');
    console.log('');
  });
}

module.exports = { server, runtime };
