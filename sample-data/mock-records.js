'use strict';

/**
 * Gera dados 100% fictícios de uma controladoria de direito bancário,
 * ancorados na data de referência informada (padrão: hoje em America/Sao_Paulo).
 *
 * Cobre explicitamente todos os casos de negócio:
 * - Dois prazos do mesmo processo (com zeros à esquerda)
 * - Data fatal hoje, juntada hoje e data fatal anterior com Protocolado = Não
 * - Juntada preenchida com Protocolado = Não
 * - Datas vazias preservadas vazias (sem dedução entre as 4 colunas de data)
 * - Datas como objeto Date nativo da planilha E como texto BR com/sem zero à esquerda
 * - Número de processo fora do padrão CNJ mantido consultável
 * - Coluna A com cabeçalho "3" e conteúdo "-"
 * - Observação (M) e Observação (P) independentes
 * - Fórmula, formatação e validação de dados em células para verificar preservação
 */

const SAMPLE_HEADERS = [
  '3',
  'Tribunal',
  'Fim do Prazo',
  'Prazo limite para juntada',
  'Número do Processo',
  'Cliente',
  'Próximos passos',
  'Priorização',
  'Tipo',
  'Última atualização',
  'Data fatal',
  'Data da juntada',
  'Observação',
  'Protocolado',
  'Responsavel',
  'Observação',
  'ID_CONTROLE_APP'
];

function getTodayIsoSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}

function addDaysIso(baseIso, deltaDays) {
  const [y, m, d] = baseIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function isoToSheetDate(iso) {
  // Simula data nativa do Google Planilhas em America/Sao_Paulo (meia-noite BRT = 03:00Z)
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 3, 0, 0));
}

function isoToBrText(iso, padZeros = true) {
  const [y, m, d] = iso.split('-').map(Number);
  if (padZeros) {
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  }
  return `${d}/${m}/${y}`;
}

function buildSampleSheetRows(referenceDateIso) {
  const baseIso = referenceDateIso || getTodayIsoSaoPaulo();
  const today = baseIso;
  const yesterday = addDaysIso(baseIso, -1);
  const twoDaysAgo = addDaysIso(baseIso, -2);
  const threeDaysAgo = addDaysIso(baseIso, -3);
  const tomorrow = addDaysIso(baseIso, 1);
  const plus3 = addDaysIso(baseIso, 3);
  const plus5 = addDaysIso(baseIso, 5);
  const plus7 = addDaysIso(baseIso, 7);

  return [
    // 1) Processo 0004821-15.2025.8.26.0100 — PRAZO 1 (Data fatal = hoje, objeto Date nativo)
    {
      values: [
        '-',
        'TJSP',
        isoToSheetDate(today),
        isoToSheetDate(tomorrow),
        '0004821-15.2025.8.26.0100',
        'Metalúrgica Horizonte Ltda.',
        'Protocolar contestação revisional de cédula de crédito bancário',
        'Urgente',
        'Prazo fatal',
        '25/11/2026 17:40',
        isoToSheetDate(today),
        '',
        'Planilha de recálculo revisada pelo núcleo financeiro',
        'Não',
        'Mariana Costa',
        'Aguardando assinatura digital do sócio diretor',
        'PRZ-DEMO-0001'
      ],
      cellMeta: {
        // Simula fórmula em coluna não editável (ex.: col B) e formatação especial para teste de preservação
        2: { formula: '=UPPER("tjsp")', format: { bold: true, background: '#f8fafc' } },
        8: { format: { background: '#fee2e2' } }
      }
    },
    // 2) MESMO PROCESSO 0004821-15.2025.8.26.0100 — PRAZO 2 (Juntada hoje + Protocolado = Não)
    {
      values: [
        '-',
        'TJSP',
        isoToBrText(plus5, true),
        isoToBrText(today, true),
        '0004821-15.2025.8.26.0100',
        'Metalúrgica Horizonte Ltda.',
        'Juntar procuração atualizada e comprovante de recolhimento de custas',
        'Alta',
        'Prazo fatal',
        '25/11/2026 14:10',
        isoToBrText(plus5, true),
        isoToBrText(today, true),
        'Conferir guia DARE paga em 24/11',
        'Não',
        'Lucas Almeida',
        'Processo com dois prazos ativos — não confundir com a contestação',
        'PRZ-DEMO-0002'
      ]
    },
    // 3) Data fatal anterior a hoje + Protocolado = Não (Pendente de conferência) + Data da juntada VAZIA
    {
      values: [
        '-',
        'TJRJ',
        isoToSheetDate(yesterday),
        '',
        '0019302-44.2024.8.19.0001',
        'Carlos Eduardo Mendes',
        'Conferir protocolo da impugnação ao cumprimento de sentença no PJe',
        'Urgente',
        'Prazo fatal',
        '24/11/2026 18:05',
        isoToBrText(yesterday, false), // Texto brasileiro sem zero à esquerda quando dia/mês < 10
        '',
        'Recibo pode ter sido anexado pelo correspondente',
        'Não',
        'Fernanda Lima',
        'Prioridade na conferência matinal da controladoria',
        'PRZ-DEMO-0003'
      ]
    },
    // 4) Data fatal 3 dias atrás + Protocolado = Não (Tipo = Renunciar)
    {
      values: [
        '-',
        'TJMS',
        isoToBrText(threeDaysAgo, false),
        '',
        '0802145-90.2025.8.12.0001',
        'Distribuidora Vale Verde S.A.',
        'Confirmar se houve renúncia expressa ao prazo recursal',
        'Alta',
        'Renunciar',
        '23/11/2026 11:20',
        isoToBrText(threeDaysAgo, false),
        '',
        'Acordo bancário homologado em audiência',
        'Não',
        'Rafael Nogueira',
        'Validar baixa junto à carteira de crédito',
        'PRZ-DEMO-0004'
      ]
    },
    // 5) Múltiplos zeros à esquerda + datas de Fim do Prazo / Limite / Juntada VAZIAS (preservar vazias)
    {
      values: [
        '-',
        'TJSP',
        '',
        '',
        '0000718-09.2025.8.26.0002',
        'Ana Paula Ferreira',
        'Elaborar manifestação sobre bloqueio SISBAJUD em conta salário',
        'Média',
        'Prazo fatal',
        '25/11/2026 09:30',
        isoToSheetDate(today),
        '',
        'Cliente encaminhou holerites dos últimos 3 meses',
        'Não',
        'Mariana Costa',
        '',
        'PRZ-DEMO-0005'
      ]
    },
    // 6) Data fatal hoje já protocolada (Protocolado = Sim) — ainda deve aparecer nos prazos fatais de hoje
    {
      values: [
        '-',
        'TJMG',
        isoToSheetDate(today),
        isoToSheetDate(today),
        '0009512-77.2025.8.13.0024',
        'Transportadora Atlântico Sul Ltda.',
        'Protocolo concluído — acompanhar despacho de liberação de veículo',
        'Baixa',
        'Prazo fatal',
        '26/11/2026 08:45',
        isoToSheetDate(today),
        isoToSheetDate(today),
        'Petição protocolada sob nº 2026/88412',
        'Sim',
        'Lucas Almeida',
        'Enviar cópia do protocolo ao cliente até 17h',
        'PRZ-DEMO-0006'
      ]
    },
    // 7) Data fatal anterior já protocolada (Protocolado = Sim) — NÃO deve aparecer como pendente de conferência
    {
      values: [
        '-',
        'TJPR',
        isoToSheetDate(twoDaysAgo),
        '',
        '0045120-33.2024.8.16.0001',
        'Supermercado Estrela do Sul Ltda.',
        'Aguardar intimação da parte contrária',
        'Baixa',
        'Prazo fatal',
        '24/11/2026 16:00',
        isoToSheetDate(twoDaysAgo),
        '',
        'Embargos à execução protocolados no prazo',
        'Sim',
        'Fernanda Lima',
        'Sem pendências',
        'PRZ-DEMO-0007'
      ]
    },
    // 8) Prazo futuro (amanhã) — fora da visão de hoje, aparece ao navegar para amanhã ou em Toda a agenda
    {
      values: [
        '-',
        'TJGO',
        isoToSheetDate(tomorrow),
        isoToSheetDate(plus3),
        '0088210-12.2025.8.09.0051',
        'Agropecuária Serra Azul Ltda.',
        'Preparar apelação sobre capitalização de juros em CPR financeira',
        'Média',
        'Prazo fatal',
        '25/11/2026 15:15',
        isoToSheetDate(tomorrow),
        isoToSheetDate(tomorrow),
        'Minuta em revisão com sócio bancário',
        'Não',
        'Rafael Nogueira',
        'Conferir preparo recursal antes do protocolo',
        'PRZ-DEMO-0008'
      ]
    },
    // 9) Processo fora do formato CNJ + TODAS as datas vazias (deve continuar consultável!)
    {
      values: [
        '-',
        'PROCON-SP',
        '',
        '',
        'PROC-ADM-2025/0088-B',
        'João Ricardo Silveira',
        'Acompanhar resposta administrativa sobre renegociação de cartão consignado',
        'Sem urgência',
        'Não se aplica',
        '20/11/2026 10:00',
        '',
        '',
        'Procedimento administrativo sem prazo judicial fixado',
        'Não',
        'Mariana Costa',
        'Manter monitoramento quinzenal',
        'PRZ-DEMO-0009'
      ]
    },
    // 10) Juntada futura com Data fatal ainda mais distante
    {
      values: [
        '-',
        'TRF3',
        isoToSheetDate(plus7),
        isoToSheetDate(plus3),
        '5001290-41.2025.4.03.6100',
        'Indústria Têxtil Bandeirantes S.A.',
        'Anexar contrato social consolidado e balanço patrimonial',
        'Baixa',
        'Prazo fatal',
        '22/11/2026 13:50',
        isoToSheetDate(plus7),
        isoToSheetDate(plus3),
        'Ação ordinária contra instituição financeira pública',
        'Não',
        'Lucas Almeida',
        'Documentos solicitados à contabilidade do cliente',
        'PRZ-DEMO-0010'
      ]
    }
  ];
}

const SAMPLE_DROPDOWN_VALIDATIONS = {
  8: ['Baixa', 'Média', 'Alta', 'Urgente', 'Sem urgência'],
  9: ['Renunciar', 'Prazo fatal', 'Não se aplica'],
  14: ['Sim', 'Não']
};

module.exports = {
  SAMPLE_HEADERS,
  SAMPLE_DROPDOWN_VALIDATIONS,
  getTodayIsoSaoPaulo,
  addDaysIso,
  isoToSheetDate,
  isoToBrText,
  buildSampleSheetRows
};
