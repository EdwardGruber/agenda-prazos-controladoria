window.agendaPages = (() => {
  const config = window.agendaConfig;
  let token = '';
  let expiresAt = 0;

  function expireSession() {
    token = '';
    throw new Error('Sua sessão expirou. Copie as alterações em aberto e use Sair para entrar novamente.');
  }

  async function call(method, payload) {
    if (!token || Date.now() >= expiresAt) return expireSession();
    const url = 'https://script.googleapis.com/v1/scripts/' + encodeURIComponent(config.deploymentId) + ':run';
    const response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ function: method, parameters: payload === undefined ? [] : [payload] })
    });
    if (response.status === 401) return expireSession();
    const data = await response.json();
    if (!response.ok || data.error) {
      const error = data.error || {};
      const detail = (error.details || []).find(item => item.errorMessage);
      throw new Error(detail?.errorMessage || error.message || 'Falha na comunicação com o Google.');
    }
    if (!data.response?.result) throw new Error('O Google devolveu uma resposta incompleta.');
    return data.response.result;
  }

  function start(loadAgenda) {
    const button = document.getElementById('loginButton');
    const message = document.getElementById('loginMessage');
    document.getElementById('logout').onclick = () => location.reload();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(console.error);
    }
    if (!config.clientId || !config.deploymentId) {
      message.textContent = 'O administrador precisa configurar a conexão com o Google antes do primeiro acesso.';
      button.disabled = true;
      return;
    }
    button.onclick = () => {
      const oauth = window.google?.accounts?.oauth2;
      if (!oauth) {
        message.textContent = 'O login do Google ainda não carregou. Verifique a conexão e tente novamente.';
        return;
      }
      const onError = () => {
        button.disabled = false;
        message.textContent = 'A entrada foi interrompida. Tente novamente e permita os acessos solicitados.';
      };
      const client = oauth.initTokenClient({
        client_id: config.clientId,
        scope: config.scopes.join(' '),
        error_callback: onError,
        callback: result => {
          if (!result.access_token || !oauth.hasGrantedAllScopes(result, ...config.scopes)) return onError();
          token = result.access_token;
          expiresAt = Date.now() + Number(result.expires_in) * 1000;
          document.getElementById('loginPanel').hidden = true;
          document.getElementById('agendaContent').hidden = false;
          loadAgenda();
        }
      });
      button.disabled = true;
      client.requestAccessToken({ prompt: 'select_account' });
    };
  }
  return { start, call };
})();
