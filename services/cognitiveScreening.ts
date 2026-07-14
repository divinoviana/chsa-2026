// =====================================================================
// Triagens CHSA — neurodivergência (graus) + superdotação (Renzulli)
// =====================================================================
// Base científica dos questionários (itens ORIGINAIS inspirados em
// instrumentos validados e de domínio público):
//  - TDAH: estrutura do ASRS v1.1 (OMS) — desatenção + hiperatividade/impulsividade
//  - TEA: estrutura do AQ-10 adolescente (Baron-Cohen et al.) — social,
//    atenção a detalhes, flexibilidade, comunicação, imaginação
//  - Dislexia: checklists de dificuldades de leitura/escrita (IDA)
//  - Superdotação: Modelo dos Três Anéis de Renzulli — habilidade acima
//    da média + criatividade + envolvimento com a tarefa
//
// NADA aqui é diagnóstico. Os resultados são INDICADORES em graus
// (mínimo/leve/moderado/expressivo) para orientar encaminhamento.
// =====================================================================

import { Rng, DomainScore } from './cognitiveEngine';

export type ScreeningKey = 'tdah' | 'tea' | 'dislexia';

export interface LikertItem {
  id: string;
  screening: ScreeningKey | 'criatividade' | 'envolvimento';
  text: string;
  reversed?: boolean; // item invertido (concordar = MENOS indicador)
}

// Escala de resposta (0-4)
export const LIKERT_LABELS = ['Nunca', 'Raramente', 'Às vezes', 'Frequentemente', 'Quase sempre'];

// ---------------------------------------------------------------------
// TDAH — 9 itens (5 desatenção + 4 hiperatividade/impulsividade)
// ---------------------------------------------------------------------
const TDAH_ITEMS: LikertItem[] = [
  { id: 'tdah1', screening: 'tdah', text: 'Tenho dificuldade de manter a atenção em tarefas longas ou monótonas (aulas, leituras, provas).' },
  { id: 'tdah2', screening: 'tdah', text: 'Cometo erros por distração em atividades escolares, mesmo sabendo a matéria.' },
  { id: 'tdah3', screening: 'tdah', text: 'Deixo tarefas pela metade e pulo para outra coisa antes de terminar.' },
  { id: 'tdah4', screening: 'tdah', text: 'Perco ou esqueço objetos necessários no dia a dia (material, celular, chaves, prazos).' },
  { id: 'tdah5', screening: 'tdah', text: 'Adio tarefas que exigem esforço mental prolongado até o último minuto.' },
  { id: 'tdah6', screening: 'tdah', text: 'Sinto inquietação: mexo mãos ou pés, balanço na cadeira ou preciso me levantar.' },
  { id: 'tdah7', screening: 'tdah', text: 'Falo ou ajo por impulso e me arrependo logo depois (respondo antes da pergunta acabar).' },
  { id: 'tdah8', screening: 'tdah', text: 'Tenho dificuldade de esperar minha vez em filas, jogos ou conversas.' },
  { id: 'tdah9', screening: 'tdah', text: 'Minha cabeça parece "ligada num motor": muitos pensamentos ao mesmo tempo, difícil relaxar.' },
];

// ---------------------------------------------------------------------
// TEA — 10 itens (estilo AQ-10 adolescente)
// ---------------------------------------------------------------------
const TEA_ITEMS: LikertItem[] = [
  { id: 'tea1', screening: 'tea', text: 'Percebo pequenos detalhes (sons, padrões, mudanças) que outras pessoas não notam.' },
  { id: 'tea2', screening: 'tea', text: 'Tenho dificuldade de entender o que a pessoa sente só olhando para o rosto dela.', },
  { id: 'tea3', screening: 'tea', text: 'Mudanças de rotina ou planos de última hora me deixam muito desconfortável.' },
  { id: 'tea4', screening: 'tea', text: 'Em conversas de grupo, tenho dificuldade de acompanhar quem fala e quando é minha vez.' },
  { id: 'tea5', screening: 'tea', text: 'Consigo me concentrar tão fundo num interesse que esqueço do mundo ao redor (hiperfoco).' },
  { id: 'tea6', screening: 'tea', text: 'Entendo frases no sentido literal e demoro a perceber ironias ou piadas de duplo sentido.' },
  { id: 'tea7', screening: 'tea', text: 'Sons altos, luzes fortes, texturas ou etiquetas de roupa me incomodam mais do que aos outros.' },
  { id: 'tea8', screening: 'tea', text: 'Acho fácil fazer novos amigos e puxar conversa com desconhecidos.', reversed: true },
  { id: 'tea9', screening: 'tea', text: 'Prefiro fazer as coisas sempre do mesmo jeito, na mesma ordem.' },
  { id: 'tea10', screening: 'tea', text: 'Quando converso, olhar nos olhos da pessoa me custa esforço consciente.' },
];

// ---------------------------------------------------------------------
// Dislexia / transtorno de leitura — 7 itens
// ---------------------------------------------------------------------
const DISLEXIA_ITEMS: LikertItem[] = [
  { id: 'dis1', screening: 'dislexia', text: 'Leio devagar e preciso reler o mesmo trecho várias vezes para entender.' },
  { id: 'dis2', screening: 'dislexia', text: 'Troco, invirto ou omito letras/sílabas quando leio ou escrevo (ex.: "casa"/"saca").' },
  { id: 'dis3', screening: 'dislexia', text: 'Tenho dificuldade em ler em voz alta na frente de outras pessoas.' },
  { id: 'dis4', screening: 'dislexia', text: 'Escrever textos me cansa muito mais do que explicar a mesma coisa falando.' },
  { id: 'dis5', screening: 'dislexia', text: 'Confundo direita/esquerda ou me perco em sequências (meses, alfabeto, tabuada).' },
  { id: 'dis6', screening: 'dislexia', text: 'Minha ortografia é irregular: escrevo a mesma palavra de jeitos diferentes.' },
  { id: 'dis7', screening: 'dislexia', text: 'Entendo bem quando alguém explica falando, mas textos escritos me confundem.' },
];

// ---------------------------------------------------------------------
// Superdotação (Renzulli) — criatividade (6) + envolvimento (6)
// O anel "habilidade acima da média" vem do desempenho no teste (ICG).
// ---------------------------------------------------------------------
const CRIATIVIDADE_ITEMS: LikertItem[] = [
  { id: 'cri1', screening: 'criatividade', text: 'Tenho ideias que os outros acham incomuns ou "fora da caixa".' },
  { id: 'cri2', screening: 'criatividade', text: 'Gosto de imaginar cenários alternativos: "e se o mundo fosse diferente?"' },
  { id: 'cri3', screening: 'criatividade', text: 'Encontro soluções diferentes das ensinadas para resolver problemas.' },
  { id: 'cri4', screening: 'criatividade', text: 'Faço perguntas que surpreendem professores ou adultos.' },
  { id: 'cri5', screening: 'criatividade', text: 'Crio coisas por conta própria (histórias, desenhos, músicas, códigos, invenções).' },
  { id: 'cri6', screening: 'criatividade', text: 'Percebo conexões entre assuntos que parecem não ter nada a ver entre si.' },
];

const ENVOLVIMENTO_ITEMS: LikertItem[] = [
  { id: 'env1', screening: 'envolvimento', text: 'Quando um assunto me interessa, estudo por conta própria muito além do que a escola pede.' },
  { id: 'env2', screening: 'envolvimento', text: 'Persisto em problemas difíceis mesmo depois de errar várias vezes.' },
  { id: 'env3', screening: 'envolvimento', text: 'Perco a noção do tempo quando estou envolvido(a) num projeto que gosto.' },
  { id: 'env4', screening: 'envolvimento', text: 'Estabeleço padrões altos para mim e fico incomodado(a) com trabalho malfeito.' },
  { id: 'env5', screening: 'envolvimento', text: 'Termino projetos pessoais que começo, mesmo sem ninguém cobrar.' },
  { id: 'env6', screening: 'envolvimento', text: 'Aprendo coisas novas mais rápido que a maioria dos colegas.' },
];

const shuffleWith = <T,>(rng: Rng, arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Monta o questionário completo com ordem embaralhada por sessão (anti-decoreba). */
export function buildQuestionnaire(rng: Rng): LikertItem[] {
  return shuffleWith(rng, [
    ...TDAH_ITEMS, ...TEA_ITEMS, ...DISLEXIA_ITEMS, ...CRIATIVIDADE_ITEMS, ...ENVOLVIMENTO_ITEMS,
  ]);
}

// ---------------------------------------------------------------------
// Pontuação e graus
// ---------------------------------------------------------------------
export interface ScreeningResult {
  key: ScreeningKey;
  label: string;
  emoji: string;
  score: number;       // média 0-4
  level: 0 | 1 | 2 | 3; // mínimo / leve / moderado / expressivo
  levelLabel: string;
  note: string;
}

const LEVEL_LABELS = ['Mínimo', 'Leve', 'Moderado', 'Expressivo'];
export const LEVEL_COLORS = ['bg-emerald-500', 'bg-sky-500', 'bg-amber-500', 'bg-rose-500'];

function meanScore(items: LikertItem[], answers: Record<string, number>): number {
  const vals = items
    .filter(it => answers[it.id] !== undefined)
    .map(it => (it.reversed ? 4 - answers[it.id] : answers[it.id]));
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function toLevel(mean: number): 0 | 1 | 2 | 3 {
  if (mean >= 2.6) return 3;
  if (mean >= 2.0) return 2;
  if (mean >= 1.3) return 1;
  return 0;
}

export function scoreScreenings(
  answers: Record<string, number>,
  domains: DomainScore[],
): ScreeningResult[] {
  const dz = (k: string) => domains.find(d => d.key === k)?.z ?? 0;

  const defs: { key: ScreeningKey; label: string; emoji: string; items: LikertItem[]; perfNote: () => string | null }[] = [
    {
      key: 'tdah', label: 'Indicadores de TDAH', emoji: '⚡', items: TDAH_ITEMS,
      // Corroboração de desempenho: perfil clássico TDAH = velocidade/memória
      // de trabalho rebaixadas em relação ao raciocínio (discrepância WISC).
      perfNote: () => {
        const disc = (dz('matrizes') + dz('analogias')) / 2 - (dz('velocidade') + dz('memoria')) / 2;
        return disc > 0.8 ? 'O desempenho corrobora: velocidade de processamento e memória de trabalho ficaram bem abaixo do raciocínio geral — padrão comum em TDAH.' : null;
      },
    },
    {
      key: 'tea', label: 'Indicadores de TEA', emoji: '🧿', items: TEA_ITEMS,
      perfNote: () => {
        const disc = (dz('matrizes') + dz('rotacao')) / 2 - dz('analogias');
        return disc > 0.9 ? 'O desempenho mostra raciocínio visual bem acima do verbal — perfil frequente (não exclusivo) no espectro autista.' : null;
      },
    },
    {
      key: 'dislexia', label: 'Indicadores de Dislexia', emoji: '📖', items: DISLEXIA_ITEMS,
      perfNote: () => {
        const disc = (dz('matrizes') + dz('rotacao') + dz('series')) / 3 - dz('analogias');
        return disc > 0.9 ? 'O raciocínio não-verbal ficou bem acima do verbal, o que reforça a hipótese de dificuldade específica com linguagem escrita (e não de capacidade geral).' : null;
      },
    },
  ];

  return defs.map(def => {
    const mean = meanScore(def.items, answers);
    let level = toLevel(mean);
    const extra = def.perfNote();
    const baseNotes: Record<number, string> = {
      0: 'Sem sinais relevantes nesta triagem.',
      1: 'Alguns sinais presentes, dentro do que é comum na população. Vale observar.',
      2: 'Sinais consistentes. Recomenda-se conversar com a família e observar em sala; considerar avaliação profissional.',
      3: 'Sinais fortes e frequentes. Recomenda-se encaminhamento para avaliação com profissional especializado (psicólogo/neuropsicólogo).',
    };
    return {
      key: def.key,
      label: def.label,
      emoji: def.emoji,
      score: Math.round(mean * 100) / 100,
      level,
      levelLabel: LEVEL_LABELS[level],
      note: baseNotes[level] + (extra ? ' ' + extra : ''),
    };
  });
}

// ---------------------------------------------------------------------
// Superdotação — Três Anéis de Renzulli
// ---------------------------------------------------------------------
export interface GiftednessResult {
  level: 0 | 1 | 2 | 3;
  levelLabel: string;
  rings: { label: string; value: number; max: number; high: boolean }[];
  note: string;
}

export function scoreGiftedness(icg: number, answers: Record<string, number>): GiftednessResult {
  const cri = meanScore(CRIATIVIDADE_ITEMS, answers);
  const env = meanScore(ENVOLVIMENTO_ITEMS, answers);
  const abilityHigh = icg >= 120;
  const abilityVery = icg >= 128;
  const criHigh = cri >= 2.7;
  const envHigh = env >= 2.7;

  const ringsHigh = [abilityHigh, criHigh, envHigh].filter(Boolean).length;
  let level: 0 | 1 | 2 | 3 = 0;
  if (abilityVery && ringsHigh === 3) level = 3;
  else if (ringsHigh === 3 || (abilityVery && ringsHigh >= 2)) level = 2;
  else if (ringsHigh >= 2 || abilityVery) level = 1;

  const labels = ['Sem indicadores', 'Indicadores iniciais', 'Indicadores consistentes', 'Indicadores fortes'];
  const notes = [
    'O perfil atual não sugere superdotação, o que não diminui nenhum talento específico.',
    'Há sinais em parte dos critérios de Renzulli. Vale acompanhar e oferecer desafios além do currículo.',
    'Dois ou três anéis de Renzulli em nível alto. Recomenda-se enriquecimento curricular e avaliação formal (AH/SD) na rede.',
    'Os três anéis (habilidade + criatividade + envolvimento) em nível alto, com desempenho ≥ 2 DP. Encaminhar para avaliação formal de Altas Habilidades/Superdotação (Sala de Recursos/NAAH-S).',
  ];

  return {
    level,
    levelLabel: labels[level],
    rings: [
      { label: 'Habilidade acima da média (ICG)', value: icg, max: 150, high: abilityHigh },
      { label: 'Criatividade', value: Math.round(cri * 100) / 100, max: 4, high: criHigh },
      { label: 'Envolvimento com a tarefa', value: Math.round(env * 100) / 100, max: 4, high: envHigh },
    ],
    note: notes[level],
  };
}
