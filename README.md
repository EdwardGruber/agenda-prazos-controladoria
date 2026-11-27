# Agenda de Prazos — Controladoria (Direito Bancário)

Aplicação web em **Google Apps Script + HTML/CSS/JavaScript** conectada ao **Google Planilhas**, organizada para desenvolvimento local com **clasp** e **Git**.

- **Código e exemplos fictícios** ficam neste repositório (sem dados reais e sem credenciais).
- **Dados reais** ficam exclusivamente no Google Drive do escritório.
- **Execução hospedada no Google** (`USER_ACCESSING`), funcionando com o computador desligado e respeitando as permissões individuais de leitura ou edição na planilha.

---

## Uso pelo escritório

A versão instalável usa o GitHub Pages para a interface e a conta Google de cada integrante para consultar e editar a planilha.

### Publicar a versão instalável

1. Prepare a planilha conforme a seção 2. Envie o código de `src/` ao Apps Script e configure as propriedades da seção 3, passos A a C.
2. No Google Cloud, use um projeto padrão do escritório, ative a **Google Apps Script API** e vincule o mesmo número de projeto em **Configurações do projeto** no Apps Script. Configure a tela de consentimento OAuth e os escopos de `src/appsscript.json`. Para um aplicativo interno do Workspace, selecione o público interno. Em teste com público externo, cadastre os e-mails de teste.
3. Crie um **ID do cliente OAuth** do tipo **Aplicativo da Web**. Em origens JavaScript autorizadas, inclua `https://edwardgruber.github.io`. Para testar localmente, inclua também `http://localhost:8080`.
4. No Apps Script, use **Implantar → Nova implantação → Executável da API**. Autorize o público do escritório e copie o **ID da implantação**. O passo D, mais abaixo, serve para quem também quer usar a interface hospedada pelo Google.
5. No repositório GitHub, em **Settings → Secrets and variables → Actions → Variables**, crie `GOOGLE_CLIENT_ID` e `APPS_SCRIPT_DEPLOYMENT_ID`. Esses identificadores fazem parte da interface pública. O ID da planilha fica nas propriedades do Apps Script.
6. Em **Settings → Pages → Source**, selecione **GitHub Actions**. Envie as mudanças para `main` ou execute **Publicar agenda no GitHub Pages** na aba Actions. O fluxo testa o projeto e publica apenas o conteúdo gerado em `dist/`. Em atualizações do servidor, publique também a nova versão do executável no Apps Script.
7. Abra `https://edwardgruber.github.io/agenda-prazos-controladoria/`, entre com a conta Google e confira a agenda com um editor e um leitor. No Android ou computador, use o comando de instalação do navegador. No iPhone, abra no Safari e escolha **Compartilhar → Adicionar à Tela de Início**.

A consulta e a gravação precisam de internet. O aplicativo mantém o token de acesso e os registros apenas na memória da página. O botão **Sair** encerra a sessão local. O compartilhamento da planilha continua sob controle do escritório.

Para conferir a versão estática local, execute `npm run build:pages` e `python -m http.server 8080 --directory dist`. Acesse `http://localhost:8080`. Para autenticação real, defina as duas variáveis acima no ambiente antes do build. Para explorar com dados fictícios, use `npm start` conforme a seção 1.

### Atualizar uma agenda já publicada

No mesmo projeto Google Cloud do login, ative **Google Sheets API**. O manifesto já declara o serviço avançado Sheets v4. Atualize o projeto Apps Script com os arquivos de `src/`, incluindo `Management.gs` e `appsscript.json`. Em **Implantar → Gerenciar implantações**, edite o **Executável da API** existente e selecione **Nova versão → Implantar** para manter o mesmo identificador. Publique a interface pelo fluxo GitHub Pages. A planilha atual e os IDs existentes podem ser usados diretamente.

## Estrutura do projeto

```text
agenda-prazos-controladoria/
├── src/                                   # Código enviado ao Google Apps Script (rootDir do clasp)
│   ├── appsscript.json                    # Manifesto (America/Sao_Paulo, executeAs: USER_ACCESSING)
│   ├── Config.gs                          # Leitura de ScriptProperties (SPREADSHEET_ID, SHEET_NAME) e mapa A..P
│   ├── Domain.gs                          # Regras de datas BR, processo, visão diária e controle de conflito
│   ├── SheetRepository.gs                 # Acesso ao Google Planilhas, permissões, ID estável (Q) e gravação seletiva
│   ├── Code.gs                            # Entrypoint Web App (doGet + endpoints google.script.run)
│   ├── Index.html                         # Interface desktop de consulta, filtros e edição
│   ├── Styles.html                        # Estilos da tabela, badges, modal e banner de demonstração
│   └── AppScript.html                     # Lógica de interface, filtros locais e confirmação antes de gravar
├── local-demo/
│   ├── gas-runtime.js                     # Simulador fiel do runtime Apps Script para testes e demo local
│   └── server.js                          # Servidor HTTP local com dados fictícios e banner visível
├── sample-data/
│   ├── agenda-controladoria-exemplo.csv   # Planilha fictícia (colunas A a P) pronta para importar no Google Planilhas
│   └── mock-records.js                    # Massa fictícia de direito bancário usada no demo e nos testes
├── tests/
│   └── run-tests.js                       # Testes automatizados ponta a ponta
├── .clasp.json.example                    # Modelo de configuração do clasp (nunca versionar .clasp.json real)
├── .claspignore                           # Restringe o push do clasp à pasta src/
└── .gitignore                             # Bloqueia credenciais, .clasp.json e arquivos .xlsx
```

---

## 1. Rodar Localmente (Modo Demonstração + Testes)

Requisito: **Node.js 18+** (sem necessidade de instalar dependências para rodar o demo ou os testes).

```bash
# 1. Executar todos os testes automatizados
npm test

# 2. Subir o modo de demonstração local
npm start
```

Abra **`http://127.0.0.1:3000`** no navegador.

A barra superior laranja (**MODO DEMONSTRAÇÃO LOCAL**) deixa explícito que a tela usa dados fictícios em memória e oferece controles rápidos para testar antes de conectar a conta do escritório:
- Alternar perfil simulado entre **Editor (Controladoria)** e **Somente leitura (Consulta)**;
- **Reordenar planilha** (simula ordenação feita por um colega enquanto você está com um registro aberto);
- **Simular edição de colega** (força conflito de edição simultânea para testar o aviso e o recarregamento);
- **Resetar demo** para restaurar os dados fictícios iniciais.

---

## 2. Preparar a Planilha de Trabalho no Google Drive

1. Converta a planilha `.xlsx` atual para o formato nativo **Google Planilhas**:
   - Abra o arquivo no Google Planilhas e clique em **Arquivo → Salvar como Planilhas Google** (recomendado começar primeiro com uma **cópia de trabalho** ou importar `sample-data/agenda-controladoria-exemplo.csv` para homologação).
2. Confira se a aba de origem tem os cabeçalhos na linha 1 nas colunas **A a P**:
   `3 | Tribunal | Fim do Prazo | Prazo limite para juntada | Número do Processo | Cliente | Próximos passos | Priorização | Tipo | Última atualização | Data fatal | Data da juntada | Observação | Protocolado | Responsavel | Observação`
3. Mantenha a coluna **E (`Número do Processo`)** formatada como **Texto simples** para preservar zeros à esquerda.
4. Compartilhe a planilha com a equipe usando as permissões nativas do Google Drive:
   - **Editor**: pode consultar e salvar alterações pelo app;
   - **Leitor (Visualizador)**: pode consultar, pesquisar e filtrar, mas o servidor bloqueia qualquer gravação.
5. Anote o **ID da planilha** (trecho entre `/d/` e `/edit` na URL do Google Planilhas) e o **nome exato da aba** (ex.: `Prazos`).

---

## 3. Publicar na Infraestrutura do Google (clasp + Web App)

> Execute esta etapa na conta Google do escritório (o arquivo `.clasp.json` e o login do clasp ficam fora do Git).

### Passo A — Instalar dependências de deploy e autenticar no clasp

```bash
npm install
npm run clasp:login
```

Ative a **API do Google Apps Script** na conta Google em: `https://script.google.com/home/usersettings`.

### Passo B — Criar/vincular o projeto Apps Script e enviar o código

Opção 1 (criar novo projeto standalone via clasp):
```bash
npx @google/clasp create --type webapp --title "Agenda Prazos Controladoria" --rootDir src
npm run clasp:push
```

Opção 2 (vincular a um projeto já criado):
1. Copie `.clasp.json.example` para `.clasp.json` e preencha o `scriptId` real.
2. Execute `npm run clasp:push`.

### Passo C — Configurar a planilha e inicializar IDs estáveis (uma única vez)

1. Abra o editor do Apps Script (`npm run clasp:open`).
2. Vá em **Configurações do projeto (ícone de engrenagem) → Propriedades do script** e adicione:
   - `SPREADSHEET_ID` = `<ID da cópia de trabalho no Google Planilhas>`
   - `SHEET_NAME` = `<Nome exato da aba de origem>`
   - `TIMEZONE` = `America/Sao_Paulo`
3. No editor, execute a função **`garantirIdsNaPlanilha`** uma vez para criar a coluna técnica **`ID_CONTROLE_APP`** ao final da planilha (coluna Q) para todas as linhas preenchidas, sem tocar nas colunas A a P nem na `Última atualização`.

### Passo D — Gerar o link compartilhado (Web App)

1. No editor do Apps Script, clique em **Implantar → Nova implantação**.
2. Em **Selecionar tipo**, escolha **App da Web**.
3. Configure exatamente:
   - **Executar como:** `Usuário que acessa o app da Web` (`USER_ACCESSING`)
   - **Quem pode acessar:** `Qualquer pessoa com uma Conta do Google` *(ou `Qualquer pessoa em <seu domínio>` se o escritório usar Google Workspace)*.
4. Clique em **Implantar** e copie a **URL do App da Web (`.../exec`)**.
5. Compartilhe esse link com a equipe. Na primeira abertura, cada integrante autorizará o acesso com a própria conta Google, e o app aplicará automaticamente sua permissão real (Editor ou Leitor) na planilha.

---

## Regras de Segurança e Integridade Implementadas

- **Pendentes de conferência:** registros com `Data fatal` anterior à data consultada e `Protocolado = Não` são sinalizados como *Pendente de conferência* — a passagem da data, sozinha, não é tratada como perda de prazo.
- Editores podem cadastrar processos, editar os campos de identificação e as quatro datas e escrever na coluna Próximos passos. O botão Gerenciar listas permite adicionar ou excluir responsáveis e prioridades. A exclusão preserva os valores dos registros anteriores.
- A partir desta versão, cada criação e edição feita pelo app grava data, e-mail da sessão, ação e campos modificados na aba **Histórico da Agenda**, criada automaticamente na primeira gravação. O histórico também aparece no detalhe do processo. Os dados e o evento são gravados juntos usando uma atualização em lote do Google Sheets.
- **Identificador estável (`ID_CONTROLE_APP`):** suporta múltiplos prazos do mesmo processo e reordenações da planilha sem gravar na linha errada.
- **Controle de concorrência:** utiliza `LockService` e verificação de versão do registro antes de gravar; se outro colega alterou a linha, o salvamento é interrompido com alerta de conflito e botão para recarregar os dados atuais.
- **Segurança de credenciais:** `.clasp.json`, `.clasprc.json`, `.env*` e arquivos `.xlsx` estão bloqueados no `.gitignore`.
