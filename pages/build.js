const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const manifest = JSON.parse(read('src/appsscript.json'));
const config = {
  clientId: process.env.GOOGLE_CLIENT_ID || '',
  deploymentId: process.env.APPS_SCRIPT_DEPLOYMENT_ID || '',
  scopes: manifest.oauthScopes
};
if (process.env.GITHUB_ACTIONS && (!config.clientId || !config.deploymentId)) {
  throw new Error('Configure GOOGLE_CLIENT_ID e APPS_SCRIPT_DEPLOYMENT_ID nas variáveis do repositório.');
}
const head = `<meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0f1f38">
  <link rel="manifest" href="./manifest.webmanifest">
  <link rel="apple-touch-icon" href="./icon-192.png">
  <script async src="https://accounts.google.com/gsi/client"></script>
  <script src="./config.js"></script>
  <script src="./access.js"></script>`;
const html = read('src/Index.html')
  .replace("<?!= include('Styles'); ?>", () => head + read('src/Styles.html'))
  .replace('<body>', () => '<body>' + read('pages/login.html') + '<div id="agendaContent" hidden>')
  .replace('<div class="topbar-actions">', '<div class="topbar-actions"><button type="button" class="btn btn-topbar" id="logout">Sair</button>')
  .replace("<?!= include('AppScript'); ?>", () => '</div>' + read('src/AppScript.html'));
if (html.includes('<?') || !html.includes('id="logout"')) throw new Error('Template da agenda incompatível.');

fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'index.html'), html);
fs.writeFileSync(path.join(output, 'config.js'), 'window.agendaConfig = ' + JSON.stringify(config) + ';\n');
for (const name of ['access.js', 'manifest.webmanifest', 'sw.js', 'icon-192.png', 'icon-512.png']) {
  fs.copyFileSync(path.join(__dirname, name), path.join(output, name));
}
console.log('Agenda gerada em dist/');
