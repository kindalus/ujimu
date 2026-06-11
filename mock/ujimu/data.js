// Ujimu — dados de demonstração (conteúdo ilustrativo para protótipo)
// Especialidades, respostas pré-preparadas com citações, anúncios e histórico semente.

window.UJIMU_DATA = (function () {
  const SPECIALTIES = [
    {
      id: 'facturacao',
      name: 'Facturação',
      accessCompanyId: '',
      short: 'Regime jurídico das facturas e documentos equivalentes',
      letter: 'F',
      sources: [
        'Decreto Presidencial n.º 292/18, de 3 de Dezembro',
        'Regime Jurídico das Facturas e Documentos Equivalentes',
      ],
    },
    {
      id: 'iva',
      name: 'IVA',
      accessCompanyId: '',
      short: 'Código do Imposto sobre o Valor Acrescentado',
      letter: 'I',
      sources: [
        'Lei n.º 7/19, de 24 de Abril — Código do IVA',
        'Alterações ao Código do IVA',
      ],
    },
    {
      id: 'laboral',
      name: 'Legislação Laboral',
      accessCompanyId: '',
      short: 'Lei Geral do Trabalho e regulamentação conexa',
      letter: 'L',
      sources: [
        'Lei n.º 12/23, de 27 de Dezembro — Lei Geral do Trabalho',
      ],
    },
    {
      id: 'aduaneira',
      name: 'Pauta Aduaneira',
      accessCompanyId: 'transatlantico',
      short: 'Direitos de importação e exportação',
      letter: 'P',
      sources: [
        'Pauta Aduaneira dos Direitos de Importação e Exportação',
      ],
    },
    {
      id: 'cambial',
      name: 'Regime Cambial',
      accessCompanyId: 'transatlantico',
      short: 'Operações cambiais e pagamentos ao estrangeiro',
      letter: 'R',
      sources: [
        'Lei n.º 5/97 — Lei Cambial',
        'Avisos do BNA sobre operações de mercadorias',
      ],
    },
  ];

  // Respostas pré-preparadas. parts: segmentos de texto; um número refere a citação.
  const ANSWERS = {
    facturacao: [
      {
        match: ['factura', 'emitir', 'obrigat'],
        parts: [
          { t: 'A obrigação de emissão de facturas abrange, em regra, todas as pessoas singulares ou colectivas que pratiquem operações de transmissão de bens ou prestação de serviços no exercício de uma actividade comercial ou industrial', c: 1 },
          { t: '. A factura deve ser emitida o mais tardar até ao 5.º dia útil seguinte ao da realização da operação', c: 2 },
          { t: '. Existem documentos equivalentes admitidos para situações específicas, como talões de venda em operações de retalho de baixo valor', c: 3 },
          { t: '. Recomenda-se confirmar o enquadramento concreto da sua actividade, pois há regimes simplificados com regras próprias.' },
        ],
        citations: [
          { source: 'Decreto Presidencial n.º 292/18', ref: 'Artigo 3.º — Âmbito de aplicação' },
          { source: 'Decreto Presidencial n.º 292/18', ref: 'Artigo 9.º — Prazo de emissão' },
          { source: 'Decreto Presidencial n.º 292/18', ref: 'Artigo 5.º — Documentos equivalentes' },
        ],
      },
      {
        match: ['software', 'certificado', 'sistema'],
        parts: [
          { t: 'Os contribuintes enquadrados nos regimes que exigem facturação por meios electrónicos devem utilizar software de facturação validado pela Administração Geral Tributária', c: 1 },
          { t: '. As facturas processadas por sistemas informáticos devem conter a menção «processado por programa válido» e a identificação do software utilizado', c: 2 },
          { t: '.' },
        ],
        citations: [
          { source: 'Decreto Presidencial n.º 292/18', ref: 'Artigo 13.º — Processamento informático' },
          { source: 'Regime Jurídico das Facturas', ref: 'Requisitos de menções obrigatórias' },
        ],
      },
    ],
    iva: [
      {
        match: ['taxa', 'percentagem', 'quanto'],
        parts: [
          { t: 'A taxa geral do IVA em Angola é de 14%, aplicável às transmissões de bens e prestações de serviços não abrangidas por taxas reduzidas ou isenções', c: 1 },
          { t: '. Existem taxas reduzidas para determinados bens essenciais e para operações na província de Cabinda, ao abrigo do regime especial aí aplicável', c: 2 },
          { t: '. A lista de bens sujeitos a taxa reduzida consta de anexo próprio ao Código e tem sido objecto de actualizações', c: 3 },
          { t: '.' },
        ],
        citations: [
          { source: 'Lei n.º 7/19 — Código do IVA', ref: 'Artigo 19.º — Taxas' },
          { source: 'Código do IVA', ref: 'Regime especial de Cabinda' },
          { source: 'Código do IVA', ref: 'Anexo — Bens sujeitos a taxa reduzida' },
        ],
      },
      {
        match: ['deduzir', 'dedução', 'credito', 'crédito'],
        parts: [
          { t: 'O direito à dedução do IVA suportado nasce no momento em que o imposto dedutível se torna exigível e exerce-se, em regra, na declaração do período em que se recepcionaram as facturas', c: 1 },
          { t: '. Apenas confere direito à dedução o imposto mencionado em facturas passadas na forma legal, em nome e na posse do sujeito passivo', c: 2 },
          { t: '. Há exclusões expressas do direito à dedução, nomeadamente despesas com viaturas de turismo, alimentação e bebidas, salvo excepções previstas', c: 3 },
          { t: '.' },
        ],
        citations: [
          { source: 'Código do IVA', ref: 'Artigo 22.º — Nascimento do direito à dedução' },
          { source: 'Código do IVA', ref: 'Artigo 24.º — Condições do exercício' },
          { source: 'Código do IVA', ref: 'Artigo 26.º — Exclusões do direito à dedução' },
        ],
      },
    ],
    laboral: [
      {
        match: ['férias', 'ferias', 'dias'],
        parts: [
          { t: 'O trabalhador tem direito a um período de férias remuneradas em cada ano civil, vencendo-se o direito a férias no dia 1 de Janeiro de cada ano', c: 1 },
          { t: '. A duração do período de férias é, em regra, de 22 dias úteis, podendo regimes especiais prever durações distintas', c: 2 },
          { t: '. O período de férias deve ser gozado no decurso do ano civil em que se vence, sendo a marcação acordada entre empregador e trabalhador', c: 3 },
          { t: '.' },
        ],
        citations: [
          { source: 'Lei n.º 12/23 — Lei Geral do Trabalho', ref: 'Direito a férias' },
          { source: 'Lei Geral do Trabalho', ref: 'Duração do período de férias' },
          { source: 'Lei Geral do Trabalho', ref: 'Marcação e gozo de férias' },
        ],
      },
      {
        match: ['despedimento', 'justa causa', 'rescis'],
        parts: [
          { t: 'O despedimento por iniciativa do empregador exige fundamento em justa causa, entendida como o comportamento culposo do trabalhador que, pela sua gravidade e consequências, torne imediata e praticamente impossível a subsistência da relação de trabalho', c: 1 },
          { t: '. O procedimento disciplinar é obrigatório e inclui a comunicação escrita dos factos imputados e a audição do trabalhador', c: 2 },
          { t: '. O despedimento sem justa causa confere ao trabalhador direito a indemnização nos termos legais', c: 3 },
          { t: '.' },
        ],
        citations: [
          { source: 'Lei Geral do Trabalho', ref: 'Justa causa de despedimento' },
          { source: 'Lei Geral do Trabalho', ref: 'Procedimento disciplinar' },
          { source: 'Lei Geral do Trabalho', ref: 'Indemnização por despedimento ilícito' },
        ],
      },
    ],
    aduaneira: [
      {
        match: ['importar', 'importação', 'direitos', 'taxa'],
        parts: [
          { t: 'Os direitos de importação são determinados pela classificação pautal da mercadoria, segundo a nomenclatura do Sistema Harmonizado adoptada na Pauta Aduaneira', c: 1 },
          { t: '. Para além dos direitos aduaneiros, podem incidir sobre a importação o IVA, o imposto de selo e emolumentos gerais aduaneiros', c: 2 },
          { t: '. A taxa concreta depende do código pautal de 8 dígitos atribuído ao bem; indique a mercadoria específica para uma classificação mais precisa.' },
        ],
        citations: [
          { source: 'Pauta Aduaneira', ref: 'Regras gerais de classificação' },
          { source: 'Pauta Aduaneira', ref: 'Tributação aplicável à importação' },
        ],
      },
    ],
  };

  ANSWERS.cambial = [
    {
      match: ['pagamento', 'estrangeiro', 'transfer', 'licen'],
      parts: [
        { t: 'Os pagamentos de importações de mercadorias são realizados através de instituições financeiras bancárias autorizadas, com base nos documentos comerciais e de desalfandegamento exigidos pela regulamentação do BNA', c: 1 },
        { t: '. As operações cambiais de invisíveis correntes podem estar sujeitas a licenciamento prévio consoante a natureza e o montante da operação', c: 2 },
        { t: '. Recomenda-se confirmar junto do banco comercial os requisitos documentais aplicáveis ao caso concreto.' },
      ],
      citations: [
        { source: 'Aviso do BNA — operações de mercadorias', ref: 'Pagamento de importações' },
        { source: 'Lei n.º 5/97 — Lei Cambial', ref: 'Licenciamento de operações' },
      ],
    },
  ];

  // Resposta para quando não há contexto suficiente na wiki da especialidade.
  const NO_CONTEXT = {
    noContext: true,
    parts: [
      { t: 'Não encontrei, nas fontes oficiais carregadas para esta especialidade, contexto suficiente para responder com segurança a esta pergunta. Para evitar induzi-lo em erro, prefiro não especular.' },
      { t: ' Pode reformular a pergunta com mais detalhe, ou consultar directamente as fontes da especialidade listadas abaixo.' },
    ],
    citations: [],
  };

  const ADS = [
    { brand: 'ContaCerta', tag: 'Software de facturação certificado', body: 'Emita facturas conformes em segundos. Teste grátis por 30 dias.', cta: 'Saber mais' },
    { brand: 'Kudila Seguros', tag: 'Protecção para o seu negócio', body: 'Seguro de responsabilidade civil para PME a partir de 15.000 Kz/mês.', cta: 'Pedir cotação' },
    { brand: 'Lexa Formação', tag: 'Cursos de fiscalidade', body: 'Formação prática em IVA e facturação para contabilistas. Próxima turma em Julho.', cta: 'Inscrever-me' },
  ];

  // Histórico semente (aparece após iniciar sessão)
  const SEED_HISTORY = [
    { id: 'h1', specialty: 'iva', title: 'Taxa de IVA em serviços de consultoria', when: 'Ontem' },
    { id: 'h2', specialty: 'iva', title: 'Dedução de IVA em viaturas', when: 'Há 3 dias' },
    { id: 'h3', specialty: 'facturacao', title: 'Prazo de emissão de facturas', when: 'Há 1 semana' },
    { id: 'h4', specialty: 'laboral', title: 'Cálculo de subsídio de férias', when: 'Há 2 semanas' },
  ];

  function findAnswer(specialtyId, question) {
    const q = (question || '').toLowerCase();
    const pool = ANSWERS[specialtyId] || [];
    for (const a of pool) {
      if (a.match.some((m) => q.includes(m))) return a;
    }
    // Sem correspondência: alterna entre primeira resposta e "sem contexto"
    if (q.length > 0 && q.length % 2 === 0 && pool[0]) return pool[0];
    return NO_CONTEXT;
  }

  const SUGGESTIONS = {
    facturacao: ['Quem é obrigado a emitir facturas?', 'O meu software de facturação precisa de ser certificado?'],
    iva: ['Qual é a taxa geral do IVA?', 'Posso deduzir o IVA de despesas com viaturas?'],
    laboral: ['Quantos dias de férias tenho por ano?', 'O que é justa causa de despedimento?'],
    aduaneira: ['Que direitos pago ao importar equipamento informático?'],
    cambial: ['Preciso de licenciamento para pagar uma importação?'],
  };

  return { SPECIALTIES, ANSWERS, NO_CONTEXT, ADS, SEED_HISTORY, SUGGESTIONS, findAnswer };
})();
