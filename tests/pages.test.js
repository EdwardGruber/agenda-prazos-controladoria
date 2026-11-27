const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('Pages exige login e usa a identidade autorizada para ler e salvar', async () => {
  const controls = Object.fromEntries(
    ['loginButton', 'loginMessage', 'logout', 'loginPanel', 'agendaContent'].map(id => [id, {}])
  );
  const requests = [];
  let callback;
  let received;
  const window = {
    agendaConfig: { clientId: 'teste', deploymentId: 'implantacao', scopes: ['escopo'] },
    google: { accounts: { oauth2: {
      initTokenClient(options) {
        assert.equal(options.client_id, 'teste');
        callback = options.callback;
        return { requestAccessToken() {} };
      },
      hasGrantedAllScopes: result => result.scope === 'escopo'
    } } }
  };
  const context = {
    window, navigator: {}, document: { getElementById: id => controls[id] },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ response: { result: received } }) };
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../pages/access.js'), 'utf8'), context);
  const api = window.agendaPages;
  let loads = 0;
  api.start(() => loads++);
  await assert.rejects(api.call('apiGetAgendaData'), /sessão expirou/);
  controls.loginButton.onclick();
  callback({ error: 'access_denied' });
  assert.equal(loads, 0);
  assert.equal(controls.loginButton.disabled, false);
  assert.equal(requests.length, 0);
  controls.loginButton.onclick();
  callback({ access_token: 'simulado', scope: 'escopo', expires_in: 3600 });
  assert.equal(loads, 1);
  received = { ok: true, records: [] };
  assert.equal(await api.call('apiGetAgendaData'), received);
  assert.deepEqual(JSON.parse(requests[0].options.body), { function: 'apiGetAgendaData', parameters: [] });
  const update = { recordId: '1', expectedVersion: 'v1', changes: { responsavel: 'Ana' } };
  received = { ok: false, code: 'CONFLICT' };
  assert.equal(await api.call('apiSaveRecord', update), received);
  assert.equal(requests[1].url, 'https://script.googleapis.com/v1/scripts/implantacao:run');
  assert.equal(requests[1].options.headers.Authorization, 'Bearer simulado');
  assert.deepEqual(JSON.parse(requests[1].options.body), { function: 'apiSaveRecord', parameters: [update] });
});
