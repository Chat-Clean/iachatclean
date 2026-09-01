// =============================================================
//  DADOS DE NEGÓCIO — SDR Virtual ChatClean
//  Todo o conhecimento comercial e operacional que a IA usa.
//  A lógica (state machine, chamadas OpenAI) fica no index.js;
//  os prompts em prompts.js. Aqui só CONTEÚDO.
//
//  Fonte: CLAUDE.md do vault + Comercial/ (ICP, personas, objeções)
//  + Prompts/chatclean-sdr-virtual-v2.
// =============================================================

// -------------------------------------------------------------
//  A EMPRESA
// -------------------------------------------------------------
const EMPRESA_INFO = {
    nome: 'ChatClean',
    tagline: 'CRM Omnichannel com Inteligência Artificial',
    descricao: 'Plataforma de CRM completo, atendimento multicanal, automações e inteligência artificial — tudo em um único lugar.',
    localizacao: 'Natal — Rio Grande do Norte (operação na Arena das Dunas). Atende empresas de todo o Brasil de forma 100% digital.',
    horarioSuporte: 'Segunda a sexta, em horário comercial. Não há suporte 24h nem em fins de semana.',
    site: 'chatclean.com.br'
};

// -------------------------------------------------------------
//  O QUE A PLATAFORMA FAZ (base de conhecimento do bot)
// -------------------------------------------------------------
const RECURSOS = {
    canais: 'WhatsApp pela API Oficial da Meta (WhatsApp Business API / WABA), sempre dentro das regras da Meta, Instagram (Direct, comentários e chatbot), Facebook, Telegram, Webchat (chat no site) e integrações via Webhook e n8n.',
    crm: 'CRM completo: cadastro de contatos e empresas com campos personalizados, histórico centralizado de todas as conversas, organização por etiquetas/status/origem/segmento, pipelines de vendas em kanban com etapas personalizáveis, registro de oportunidades com valor e responsável, tarefas, lembretes, follow-ups e relatórios de conversão.',
    whatsapp: 'Multiatendimento (vários atendentes no mesmo número), chatbot de triagem e fluxos, disparo em massa (campanhas, avisos, lembretes) dentro das regras da Meta, agendamento de mensagens e histórico detalhado por cliente.',
    instagram: 'Atendimento no Direct com IA, resposta automática a comentários em posts com abertura de Direct e chatbot completo — praticamente tudo que existe no WhatsApp existe no Instagram.',
    ia: 'A plataforma usa inteligência artificial (baseada em GPT-4o) para sugerir respostas, apoiar textos e automatizar fluxos quando configurado. Também é possível integrar uma IA externa dedicada ao número do cliente.',
    automacoes: 'Agendamento de mensagens em qualquer canal, fluxos automáticos baseados em eventos (novo lead, mudança de etapa) e integração com praticamente qualquer plataforma via Webhook e n8n.',
    suporte: 'Cada cliente tem um grupo exclusivo com 3 a 4 pessoas do time ChatClean. Funciona de segunda a sexta em horário comercial.'
};

// -------------------------------------------------------------
//  SEGMENTOS QUE MAIS CONVERTEM (do ICP — base real de clientes)
//  Usado para o bot reconhecer o segmento do lead e conectar com um case.
// -------------------------------------------------------------
const SEGMENTOS = {
    energia_solar:  { nome: 'Energia Solar', gancho: 'Ciclo de venda consultivo com muitos leads frios de anúncio — a IA qualifica antes de chegar no vendedor.' },
    saude:          { nome: 'Saúde / Clínicas', gancho: 'Agendamento e confirmação de consulta em alto volume, sem sobrecarregar a recepção.' },
    varejo:         { nome: 'Varejo / E-commerce', gancho: 'Atendimento, catálogo e pós-venda centralizados no WhatsApp e no Instagram.' },
    automotivo:     { nome: 'Automotivo / Motos', gancho: 'Concessionárias multi-loja distribuindo leads por departamento com IA.' },
    alimentacao:    { nome: 'Alimentação / Confeitaria', gancho: 'Pedidos e encomendas recorrentes organizados em um só lugar.' },
    servicos:       { nome: 'Serviços (cartório, seguros, BPO)', gancho: 'Processos padronizados e muita dúvida repetitiva que o bot resolve sozinho.' }
};

// -------------------------------------------------------------
//  BIBLIOTECA DE OBJEÇÕES (respostas consultivas — sem revelar preço)
//  O bot conhece isto para responder com segurança, mas NUNCA abre valores:
//  qualifica a dor e encaminha para o especialista fechar.
// -------------------------------------------------------------
const OBJECOES = {
    preco: 'Nunca informar valores. Qualificar a dor primeiro. Ancorar no custo de um lead perdido por semana: "Quanto vale pra você cada cliente que fica sem resposta? A ferramenta costuma se pagar nisso. Um especialista te passa uma proposta sob medida."',
    concorrente_barato: 'ChatClean é omnichannel + IA (GPT-4o) com atendimento humanizado, não só um chatbot de fluxo fixo. O barato que não converte sai caro.',
    ia_robotica: 'Os bots seguem um padrão humano: respostas curtas, tom de WhatsApp, no máximo 1 emoji, e transferem pro atendente a qualquer momento.',
    publico_mais_velho: 'Existe fallback humanizado e transferência pro humano. O bot resolve o repetitivo (horário, endereço, agendamento) e a pessoa entra no que importa.',
    sem_tempo: 'O onboarding é guiado e feito junto com o cliente (Onboarding, Configurações, Treinamento). Ninguém fica sozinho.',
    ja_tenho_whatsapp: 'O ChatClean não substitui o WhatsApp, ele potencializa: centraliza WhatsApp + Instagram, distribui por departamento, coloca IA e dá relatório. O WhatsApp Business puro não faz isso.',
    medo_de_nao_funcionar: 'Há casos no mesmo segmento do cliente. Começa pequeno, mede tempo de resposta e conversão, e ajusta.',
    preciso_pensar: 'Faz sentido. Ofereça deixar um resumo do que foi conversado e marcar 15 min com o especialista (ou com o sócio) pra ver a IA respondendo ao vivo.'
};

// -------------------------------------------------------------
//  DEPARTAMENTOS DE TRANSFERÊNCIA (padrão ChatClean)
//  O sinal enviado ao CRM é "Transferir para o departamento [nome]".
// -------------------------------------------------------------
const DEPARTAMENTOS = {
    comercial: 'Comercial',   // lead qualificado, quer fechar / ver proposta
    suporte:   'Suporte',     // reclamação ou problema técnico de cliente atual
    cs:        'Customer Success' // dúvidas de uso de cliente já ativo
};

// -------------------------------------------------------------
//  CAMPOS DE QUALIFICAÇÃO (checklist BANT adaptado do ICP)
//  Ordem do fluxo SDR. O index.js usa isto na state machine.
// -------------------------------------------------------------
const CAMPOS_QUALIFICACAO = [
    'objetivo', 'nome', 'empresa', 'segmento', 'cidadeEstado',
    'canais', 'volume', 'dor', 'urgencia', 'decisor'
];

module.exports = {
    EMPRESA_INFO,
    RECURSOS,
    SEGMENTOS,
    OBJECOES,
    DEPARTAMENTOS,
    CAMPOS_QUALIFICACAO
};
