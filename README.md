# Agenda de Prazos — Controladoria (Direito Bancário)

Aplicação web em **Google Apps Script + HTML/CSS/JavaScript** conectada ao **Google Planilhas**, organizada para desenvolvimento local com **clasp** e **Git**.

- **Código e exemplos fictícios** ficam neste repositório (sem dados reais e sem credenciais).
- **Dados reais** ficam exclusivamente no Google Drive do escritório.
- **Execução hospedada no Google** (`USER_ACCESSING`), funcionando com o computador desligado e respeitando as permissões individuais de leitura ou edição na planilha.

---

## Estrutura do Projeto

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
   *(Opcional: em vez da tela de propriedades, você pode chamar `configurarPlanilhaControladoria("SEU_ID", "NOME_DA_ABA")` diretamente no editor.)*
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
- **Gravação seletiva:** somente as células realmente editadas (`Próximos passos`, `Responsável`, `Priorização`, `Observação (M)`, `Observação (P)`, `Protocolado`) e `Última atualização` são gravadas, preservando a coluna A (`"3"` / `"-"`), as quatro datas independentes, fórmulas, formatação e listas suspensas.
- **Identificador estável (`ID_CONTROLE_APP`):** suporta múltiplos prazos do mesmo processo e reordenações da planilha sem gravar na linha errada.
- **Controle de concorrência:** utiliza `LockService` e verificação de versão do registro antes de gravar; se outro colega alterou a linha, o salvamento é interrompido com alerta de conflito e botão para recarregar os dados atuais.
- **Segurança de credenciais:** `.clasp.json`, `.clasprc.json`, `.env*` e arquivos `.xlsx` estão bloqueados no `.gitignore`.
