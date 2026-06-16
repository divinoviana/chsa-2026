// =====================================================================
// Serviço de IA — DeepSeek (API compatível com OpenAI)
// =====================================================================
// Funções:
//   - evaluateActivities()        → corrige envios dos alunos
//   - generateLessonActivity()    → gera atividades 5+2 para uma aula
//   - generateBimonthlyEvaluation() → gera simulado bimestral
//   - generateLessonPlan()        → gera plano de aula
//   - generatePedagogicalSummary() → relatório pedagógico (cruza notas + obs.)
// =====================================================================

import { ChartData, TableData, CrosswordData, ActivityImage } from "../types";

// ----------------------------------------------------------------------
// Tipagens
// ----------------------------------------------------------------------
export interface CorrectionResult {
  question: string;
  studentAnswer: string;
  isCorrect: boolean;
  score: number;
  feedback: string;
}

export interface AIResponse {
  generalComment: string;
  corrections: CorrectionResult[];
}

export interface EvaluationQuestion {
  id: number;
  textFragment: string;
  questionText: string;
  options: { a: string; b: string; c: string; d: string; e: string };
  correctOption: string;
  difficulty: 'Fácil' | 'Médio' | 'Difícil';
  explanation: string;
}

export interface GeneratedEvaluation {
  subject: string;
  grade: string;
  bimester: string;
  questions: EvaluationQuestion[];
  visualContent?: { type: 'image' | 'chart' | 'table' | 'crossword'; data: any };
}

export interface LessonPlan {
  title: string;
  objectives: string[];
  theory: string;
  methodology: { introduction: string; development: string; conclusion: string };
  suggestedActivity: string;
}

export interface ObjectiveQuestion {
  id: string;
  question: string;
  options: { a: string; b: string; c: string; d: string; e: string };
  correctOption: string;
}

export interface DiscursiveQuestion { id: string; question: string }

export interface LessonActivity {
  objectives: ObjectiveQuestion[];
  discursives: DiscursiveQuestion[];
  visualContent?: { type: 'image' | 'chart' | 'table' | 'crossword'; data: any };
}

export interface EvaluationQuestionItem {
  question: string;
  answer: string;
  correctAnswer?: string;
}

// ----------------------------------------------------------------------
// REDAÇÃO ENEM — 5 competências, 0–200 pontos cada, total 0–1000.
// ----------------------------------------------------------------------
export interface EnemCompetency {
  /** Pontuação 0–200, em múltiplos de 40 */
  score: number;
  /** Comentário pedagógico explicando a nota */
  feedback: string;
}

export interface EnemEssayEvaluation {
  /** C1 — Domínio da escrita formal da língua portuguesa */
  c1: EnemCompetency;
  /** C2 — Compreender a proposta e aplicar conceitos */
  c2: EnemCompetency;
  /** C3 — Selecionar, relacionar e organizar argumentos */
  c3: EnemCompetency;
  /** C4 — Mecanismos linguísticos (coesão e coerência) */
  c4: EnemCompetency;
  /** C5 — Proposta de intervenção com respeito aos direitos humanos */
  c5: EnemCompetency;
  /** Soma das 5 competências (0–1000) */
  totalScore: number;
  /** Equivalente em escala 0–10 (totalScore / 100) */
  score0to10: number;
  /** Comentário geral sobre o texto */
  generalComment: string;
  /** Pontos fortes identificados */
  strengths: string[];
  /** Pontos a melhorar */
  weaknesses: string[];
  /** Dicas práticas para o aluno */
  improvementTips: string[];
}

// ----------------------------------------------------------------------
// Cliente DeepSeek (REST, formato OpenAI)
// ----------------------------------------------------------------------
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Constantes injetadas em build-time pelo vite.config.ts via `define`.
// Essas declarações garantem que o TypeScript conhece os identificadores
// e o Vite os substitui pelo valor literal da env var no bundle.
declare const __API_KEY__: string | undefined;
declare const __DEEPSEEK_API_KEY__: string | undefined;

function isValidKey(k: any): k is string {
  return typeof k === 'string' && k.length > 5 && k !== 'undefined' && k !== 'null' && !k.includes('PLACEHOLDER');
}

function getApiKey(): string | null {
  // 1) Constantes injetadas pelo Vite em build-time (caminho mais robusto)
  try { if (isValidKey(__API_KEY__)) return __API_KEY__ as string; } catch {}
  try { if (isValidKey(__DEEPSEEK_API_KEY__)) return __DEEPSEEK_API_KEY__ as string; } catch {}

  // 2) process.env injetado pelo Vite em build-time
  try {
    const env = typeof process !== 'undefined' && (process as any).env;
    if (env) {
      for (const name of ['API_KEY', 'DEEPSEEK_API_KEY', 'VITE_API_KEY', 'VITE_DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'VITE_GEMINI_API_KEY']) {
        if (isValidKey(env[name])) return env[name] as string;
      }
    }
  } catch {}

  // 3) import.meta.env (vars VITE_*) — runtime
  try {
    const env = (import.meta as any).env || {};
    for (const name of ['VITE_API_KEY', 'VITE_DEEPSEEK_API_KEY', 'API_KEY', 'VITE_GEMINI_API_KEY']) {
      if (isValidKey(env[name])) return env[name] as string;
    }
  } catch {}

  // 4) window.__APP_CONFIG__ (escape hatch para configurar em runtime)
  try {
    const cfg = (typeof window !== 'undefined') ? (window as any).__APP_CONFIG__ : null;
    if (cfg && isValidKey(cfg.API_KEY)) return cfg.API_KEY;
  } catch {}

  return null;
}

interface DeepSeekOpts {
  model?: 'deepseek-chat' | 'deepseek-reasoner';
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

async function callDeepSeek(userPrompt: string, opts: DeepSeekOpts = {}): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      'IA desabilitada — chave API não foi embutida no bundle. ' +
      'No Vercel: Settings → Environment Variables → adicione API_KEY com escopo Production + Preview + Development → Deployments → Redeploy (sem cache).'
    );
  }

  const body: any = {
    model: opts.model || 'deepseek-chat',
    messages: [
      ...(opts.systemPrompt ? [{ role: 'system', content: opts.systemPrompt }] : []),
      { role: 'user', content: userPrompt },
    ],
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens || 8192,
    stream: false,
  };
  if (opts.json) body.response_format = { type: 'json_object' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000); // 20s max
  let res: Response;
  try {
    res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`DeepSeek ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek retornou resposta vazia.');
  return content as string;
}

/**
 * Wrapper com retry exponencial para erros 429 / quota / 5xx.
 */
async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const msg = String(error?.message || '');
    const isAbort = error?.name === 'AbortError';
    const retriable = !isAbort && /429|503|502|504|RESOURCE_EXHAUSTED|rate limit|timeout/i.test(msg);
    if (retriable && retries > 0) {
      console.warn(`[DeepSeek] Erro retriável. Reenviando em ${delay / 1000}s... (${retries} tentativas restantes)`);
      await sleep(delay);
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
}

/** Extrai JSON de uma string que pode vir com ```json ... ``` ou texto extra. */
function extractJson<T = any>(raw: string): T {
  let trimmed = (raw || '').trim();
  // remove cercas markdown
  trimmed = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  // pega do primeiro { até o último }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) trimmed = trimmed.slice(first, last + 1);
  return JSON.parse(trimmed) as T;
}

// ----------------------------------------------------------------------
// IMAGEM — DeepSeek não gera imagens. Mantemos a função por compatibilidade,
// retornando string vazia. Os fluxos que esperavam imagem caem em fallback.
// ----------------------------------------------------------------------
export const generateActivityImage = async (_prompt: string): Promise<string> => {
  console.info('[IA] Geração de imagem não disponível com DeepSeek — pulando.');
  return '';
};

// ----------------------------------------------------------------------
// FALLBACK ESTÁTICO de atividade
// ----------------------------------------------------------------------
export const generateFallbackActivity = (title: string, _theory: string, defaultQuestions?: string[]): LessonActivity => {
  const q1 = defaultQuestions?.[0] || `Explique com suas palavras o conceito principal de: ${title.split(':')[0]}.`;
  const q2 = defaultQuestions?.[1] || `Como o tema "${title}" se relaciona com a sociedade atual?`;
  return {
    objectives: [
      {
        id: 'obj1',
        question: `Sobre o tema "${title}", qual das alternativas abaixo melhor resume o conceito principal abordado na teoria?`,
        options: {
          a: 'A teoria destaca a importância de analisar criticamente os fatos e contextos apresentados.',
          b: 'O tema abordado não possui relevância prática para a compreensão da sociedade.',
          c: 'A teoria se limita a descrever eventos isolados sem conexão com o presente.',
          d: 'Os conceitos apresentados são exclusivos de outras áreas do conhecimento.',
          e: 'A análise do tema deve ser feita de forma superficial e sem embasamento.',
        },
        correctOption: 'a',
      },
      {
        id: 'obj2',
        question: 'De acordo com os conceitos fundamentais desta aula, é correto afirmar que:',
        options: {
          a: 'As mudanças sociais ocorrem de forma isolada e sem influência do passado.',
          b: 'A compreensão do tema exige uma visão ampla e conectada com diferentes realidades.',
          c: 'O estudo deste assunto serve apenas para memorização de dados históricos ou geográficos.',
          d: 'Não há evidências que comprovem a importância deste tema na atualidade.',
          e: 'A teoria apresentada contraria os princípios básicos das Ciências Humanas.',
        },
        correctOption: 'b',
      },
      {
        id: 'obj3',
        question: 'Qual a principal importância de compreender os conceitos discutidos nesta aula?',
        options: {
          a: 'Permitir a repetição de informações sem necessidade de reflexão crítica.',
          b: 'Desconsiderar as diferentes perspectivas e focar em uma única visão de mundo.',
          c: 'Desenvolver uma análise crítica e aprofundada sobre as dinâmicas sociais e humanas.',
          d: 'Limitar o conhecimento a fatos que não interferem no nosso cotidiano.',
          e: 'Ignorar as transformações históricas e focar apenas no momento presente.',
        },
        correctOption: 'c',
      },
    ],
    discursives: [
      { id: 'disc1', question: q1 },
      { id: 'disc2', question: q2 },
    ],
  };
};

// ----------------------------------------------------------------------
// 1) GERA ATIVIDADE DE AULA (5 objetivas + 2 discursivas)
// ----------------------------------------------------------------------
export const generateLessonActivity = async (lessonTitle: string, theory: string): Promise<LessonActivity> => {
  return withRetry(async () => {
    const prompt = `Você está gerando uma atividade JSON estrita.
Tema da aula: "${lessonTitle}"
Referencial teórico (resumo): "${(theory || '').substring(0, 3000)}"

Devolva APENAS um JSON válido com este formato exato (sem markdown, sem comentários):
{
  "objectives": [
    { "id": "obj1", "question": "...", "options": { "a": "...", "b": "...", "c": "...", "d": "...", "e": "..." }, "correctOption": "a" },
    ... (EXATAMENTE 5 itens)
  ],
  "discursives": [
    { "id": "disc1", "question": "..." },
    { "id": "disc2", "question": "..." }
  ],
  "visualContent": {
    "type": "table" | "chart" | "crossword",
    "data": { ...estruturado conforme o tipo... }
  }
}

Critérios:
- 5 questões objetivas no padrão ENEM/Vestibular avançado, com texto-base denso e distratores plausíveis.
- 2 discursivas que exijam argumentação fundamentada e relação com o cotidiano (idealmente Tocantins).
- Vocabulário técnico-acadêmico, sem clichês.
- correctOption é obrigatoriamente a, b, c, d ou e.`;

    const raw = await callDeepSeek(prompt, {
      model: 'deepseek-chat',
      json: true,
      temperature: 0.6,
      systemPrompt: 'Você é um professor doutor em Ciências Humanas. Sua única saída é JSON válido seguindo o schema solicitado.',
    });
    return extractJson<LessonActivity>(raw);
  });
};

// ----------------------------------------------------------------------
// 2) GERA PLANO DE AULA
// ----------------------------------------------------------------------
export const generateLessonPlan = async (subject: string, theme: string, grade: string): Promise<LessonPlan> => {
  return withRetry(async () => {
    const prompt = `Crie um plano de aula em JSON para a disciplina de ${subject}, ${grade}ª série, sobre o tema "${theme}".

Formato exato (apenas JSON, sem markdown):
{
  "title": "string",
  "objectives": ["...", "...", "..."],
  "theory": "texto longo de no mínimo 800 palavras, com citações e exemplos",
  "methodology": {
    "introduction": "10 min — provocação inicial",
    "development": "30 min — exposição dialogada",
    "conclusion": "10 min — síntese e gancho"
  },
  "suggestedActivity": "proposta prática de aplicação"
}

Critérios: rigor acadêmico, BNCC, pensamento crítico, conexão com a realidade do Tocantins.`;
    const raw = await callDeepSeek(prompt, {
      model: 'deepseek-chat',
      json: true,
      temperature: 0.6,
      maxTokens: 8192,
      systemPrompt: 'Você é um mentor pedagógico doutor. Devolva apenas JSON válido.',
    });
    return extractJson<LessonPlan>(raw);
  });
};

// ----------------------------------------------------------------------
// 3) GERA AVALIAÇÃO BIMESTRAL
// ----------------------------------------------------------------------
export const generateBimonthlyEvaluation = async (
  subjectName: string,
  grade: string,
  bimester: string,
  topics: string[]
): Promise<GeneratedEvaluation> => {
  return withRetry(async () => {
    const prompt = `Gere um simulado bimestral em JSON para ${subjectName}, ${grade}ª Série, ${bimester}º Bimestre.
Tópicos: ${topics.join(', ')}.

Formato exato (apenas JSON):
{
  "subject": "${subjectName}",
  "grade": "${grade}",
  "bimester": "${bimester}",
  "questions": [
    {
      "id": 1,
      "textFragment": "trecho de obra/artigo/notícia (3-6 linhas)",
      "questionText": "enunciado",
      "options": { "a": "...", "b": "...", "c": "...", "d": "...", "e": "..." },
      "correctOption": "a",
      "difficulty": "Fácil" | "Médio" | "Difícil",
      "explanation": "comentário pedagógico explicando a resposta"
    }
    ... (EXATAMENTE 5 questões)
  ],
  "visualContent": { "type": "table" | "chart" | "crossword", "data": {} }
}

Critérios: padrão ENEM/Vestibular elite, distratores inteligentes, recurso visual indispensável para uma das questões.`;
    const raw = await callDeepSeek(prompt, {
      model: 'deepseek-chat',
      json: true,
      temperature: 0.6,
      maxTokens: 8192,
      systemPrompt: 'Você é um especialista em avaliação educacional. Devolva apenas JSON válido.',
    });
    return extractJson<GeneratedEvaluation>(raw);
  });
};

// ----------------------------------------------------------------------
// 4) AVALIA RESPOSTAS DO ALUNO
// ----------------------------------------------------------------------
// Estratégia híbrida:
// - QUESTÕES OBJETIVAS (com `correctAnswer`): nota calculada LOCALMENTE em JS,
//   sem depender da IA. Comparação string-normalizada → 0 ou 10.
// - QUESTÕES DISCURSIVAS (sem `correctAnswer`): IA avalia.
// - COMENTÁRIO GERAL: IA escreve, mas se falhar usamos um fallback derivado
//   do desempenho objetivo.
// Assim, mesmo que a DeepSeek esteja sem saldo / fora do ar, as objetivas
// são corrigidas corretamente e o aluno NUNCA recebe 0.0 indevido.
// ----------------------------------------------------------------------

/** Normaliza string para comparação: lowercase, sem acentos, trim, sem pontuação extra. */
function normalizeAnswer(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')      // remove acentos
    .toLowerCase()
    .replace(/[\s\.,;:!?"'()\-\/]/g, '')  // remove espaços e pontuação
    .trim();
}

/** Para questões "Opção X: ...", compara a letra (X). Senão, compara a string toda. */
function isAnswerCorrect(studentAnswer: string, correctAnswer: string): boolean {
  if (!studentAnswer || !correctAnswer) return false;

  // Tenta extrair a letra (a-e) do início "Opção X:"
  const letterRe = /op[cç][aã]o\s+([a-e])/i;
  const sLetter = studentAnswer.match(letterRe)?.[1]?.toLowerCase();
  const cLetter = correctAnswer.match(letterRe)?.[1]?.toLowerCase();
  if (sLetter && cLetter) return sLetter === cLetter;

  // Senão, comparação normalizada
  return normalizeAnswer(studentAnswer) === normalizeAnswer(correctAnswer);
}

export const evaluateActivities = async (
  lessonTitle: string,
  theoryContext: string,
  questionsAndAnswers: EvaluationQuestionItem[]
): Promise<AIResponse> => {
  // 1) Separar objetivas (com gabarito) de discursivas (sem gabarito)
  const objectiveItems = questionsAndAnswers.filter(q => q.correctAnswer && q.correctAnswer.trim() !== '');
  const discursiveItems = questionsAndAnswers.filter(q => !q.correctAnswer || q.correctAnswer.trim() === '');

  // 2) Corrigir objetivas LOCALMENTE — fonte da verdade
  const objectiveCorrections: CorrectionResult[] = objectiveItems.map(q => {
    const correct = isAnswerCorrect(q.answer || '', q.correctAnswer || '');
    return {
      question: q.question,
      studentAnswer: q.answer || '(não respondida)',
      isCorrect: correct,
      score: correct ? 10 : 0,
      feedback: correct
        ? 'Correto! Você marcou a alternativa adequada.'
        : `Resposta incorreta. A alternativa correta era: ${q.correctAnswer}`,
    };
  });

  const totalObjective = objectiveCorrections.length;
  const correctObjective = objectiveCorrections.filter(c => c.isCorrect).length;
  const objectivePct = totalObjective > 0 ? Math.round((correctObjective / totalObjective) * 100) : 0;

  // 3) Avaliar discursivas via IA (apenas se houver alguma)
  let discursiveCorrections: CorrectionResult[] = [];
  let aiGeneralComment: string | null = null;

  if (discursiveItems.length > 0) {
    try {
      const prompt = `Você corrige questões DISCURSIVAS de alunos do Ensino Médio (Ciências Humanas).

Aula: "${lessonTitle}"
Contexto teórico (resumo): "${(theoryContext || '').substring(0, 2000)}"

Respostas a avaliar (JSON):
${JSON.stringify(discursiveItems.map(q => ({ question: q.question, answer: q.answer })))}

Devolva APENAS JSON neste formato exato:
{
  "generalComment": "balanço geral do desempenho nas discursivas",
  "corrections": [
    {
      "question": "(repita o enunciado)",
      "studentAnswer": "(repita a resposta do aluno)",
      "isCorrect": true | false,
      "score": (0..10),
      "feedback": "feedback detalhado, corrigindo erros conceituais e sugerindo aprofundamento"
    }
  ]
}

Critérios:
- score 0..10 conforme densidade conceitual, coerência argumentativa e domínio do tema.
- isCorrect = true quando score >= 6.
- Resposta vazia ou "não respondida" recebe score 0.`;

      const raw = await withRetry(() => callDeepSeek(prompt, {
        model: 'deepseek-chat',
        json: true,
        temperature: 0.3,
        maxTokens: 4096,
        systemPrompt: 'Você é um tutor acadêmico. Devolva apenas JSON válido.',
      }));
      const aiResult = extractJson<AIResponse>(raw);
      discursiveCorrections = aiResult.corrections || [];
      aiGeneralComment = aiResult.generalComment || null;
    } catch (err) {
      console.warn('[IA] Falha ao corrigir discursivas; aplicando fallback:', err);
      // Fallback: aceita resposta com >= 30 caracteres como nota mínima
      discursiveCorrections = discursiveItems.map(q => {
        const ans = (q.answer || '').trim();
        const score = ans.length >= 30 ? 6 : 0;
        return {
          question: q.question,
          studentAnswer: ans || '(não respondida)',
          isCorrect: score >= 6,
          score,
          feedback: score >= 6
            ? 'Resposta registrada. Aguardando avaliação detalhada do professor.'
            : 'Resposta muito breve ou ausente. O professor irá revisar.',
        };
      });
    }
  }

  // 4) Comentário geral (IA falhou ou só temos objetivas → derivado)
  let generalComment = aiGeneralComment;
  if (!generalComment) {
    generalComment = totalObjective > 0
      ? `Atividade entregue. Você acertou ${correctObjective} de ${totalObjective} questões objetivas (${objectivePct}%). ${discursiveItems.length > 0 ? 'As discursivas serão revisadas pelo professor.' : ''}`.trim()
      : 'Atividade entregue. Aguardando avaliação do professor.';
  }

  return {
    generalComment,
    corrections: [...objectiveCorrections, ...discursiveCorrections],
  };
};

// ----------------------------------------------------------------------
// 5) RELATÓRIO PEDAGÓGICO (cruza notas + observações + comportamento)
// ----------------------------------------------------------------------
export interface PedagogicalSummaryInput {
  subject: string;
  grades: number[];
  notes: string[];
  studentName?: string;
  /** Série do aluno (1, 2 ou 3) */
  studentGrade?: string | number;
  schoolClass: string;
  /** Atividades detalhadas (opcional): permite análise por aula/bimestre */
  activities?: Array<{ title: string; score: number; bimester?: number | string; date?: string; subject?: string; teacherFeedback?: string }>;
  /** Anotações de comportamento (opcional) */
  behaviorNotes?: string[];
  /** Flags de integridade: provas anuladas ou com suspeita de plágio */
  flags?: { annulled: number; plagiarism: number };
}

export const generatePedagogicalSummary = async (
  context: 'INDIVIDUAL' | 'TURMA',
  data: PedagogicalSummaryInput
): Promise<string> => {
  return withRetry(async () => {
    const target = context === 'INDIVIDUAL' ? `Aluno: ${data.studentName}` : `Turma: ${data.schoolClass}`;
    const avg = data.grades.length ? (data.grades.reduce((a, b) => a + b, 0) / data.grades.length).toFixed(2) : 'sem registros';
    const max = data.grades.length ? Math.max(...data.grades).toFixed(1) : '-';
    const min = data.grades.length ? Math.min(...data.grades).toFixed(1) : '-';

    // Formata atividades de forma legível agrupando por bimestre
    const actsByBim: Record<string, string[]> = {};
    (data.activities || []).forEach(a => {
      const bim = a.bimester ? `${a.bimester}º Bimestre` : 'Bimestre não identificado';
      if (!actsByBim[bim]) actsByBim[bim] = [];
      const dateStr = a.date ? new Date(a.date).toLocaleDateString('pt-BR') : '';
      const fb = a.teacherFeedback ? ` | Feedback: "${a.teacherFeedback}"` : '';
      actsByBim[bim].push(`  - [${a.subject || data.subject}] ${a.title}: nota ${a.score.toFixed(1)}/10 (${dateStr})${fb}`);
    });
    const activitiesFormatted = Object.entries(actsByBim)
      .map(([bim, lines]) => `${bim}:\n${lines.join('\n')}`)
      .join('\n\n');

    const flagsNote = data.flags && (data.flags.annulled > 0 || data.flags.plagiarism > 0)
      ? `\n⚠️ Alertas de integridade: ${data.flags.annulled} prova(s) anulada(s) por infrações, ${data.flags.plagiarism} suspeita(s) de plágio.`
      : '';

    const prompt = `Atue como Coordenador Pedagógico. Gere um relatório em **Markdown** para:
${target}${data.studentGrade ? ` | ${data.studentGrade}ª Série` : ''} | Turma: ${data.schoolClass || 'N/A'}
Disciplina analisada: ${data.subject}${flagsNote}

━━━ DESEMPENHO QUANTITATIVO ━━━
Avaliações registradas: ${data.grades.length}
Média geral: ${avg}/10 | Maior: ${max} | Menor: ${min}

Histórico por atividade:
${activitiesFormatted || '(sem atividades registradas)'}

━━━ ANOTAÇÕES DO PROFESSOR ━━━
Feedbacks escritos nas submissões:
${(data.notes || []).map((n, i) => `${i + 1}. ${n}`).join('\n') || '(nenhum)'}

${data.behaviorNotes?.length ? `Anotações de acompanhamento (comportamento, saúde, família, pedagógico):
${data.behaviorNotes.map((n, i) => `${i + 1}. ${n}`).join('\n')}` : ''}

━━━ ESTRUTURA OBRIGATÓRIA DO RELATÓRIO ━━━

## 1. Análise de Desempenho
Interprete as notas: tendência (melhorando/piorando), evolução por bimestre, dispersão entre disciplinas, pontos de atenção. ${data.grades.length === 0 ? 'ATENÇÃO: nenhuma avaliação registrada — aponte isso como dado relevante.' : ''}

## 2. Síntese Qualitativa
O que as anotações revelam sobre engajamento, dificuldades, contexto familiar/saúde e potencialidades? Conecte com o desempenho quantitativo.

## 3. Cruzamento de Indicadores
Identifique padrões: queda nas notas + problema comportamental? Bom desempenho em certas disciplinas mas não em outras? Alguma mudança brusca ao longo do ano?${data.flags?.annulled ? ' Considere as provas anuladas como sinal de risco.' : ''}

## 4. Plano de Intervenção Pedagógica
Liste 3 a 5 ações **concretas, mensuráveis e com prazo** (curto/médio prazo):
- Estratégias específicas para sala de aula
- Articulações necessárias (família, coordenação, outras disciplinas)
- Indicadores de acompanhamento (como saber se a intervenção está funcionando)

Tom: profissional, empático, orientado a soluções. NÃO invente dados que não estejam acima.`;

    return callDeepSeek(prompt, {
      model: 'deepseek-chat',
      temperature: 0.5,
      maxTokens: 4096,
      systemPrompt: 'Você é um Coordenador Pedagógico experiente. Produza relatórios analíticos em Markdown bem estruturado, sem inventar dados que não estejam na entrada.',
    });
  });
};

// ----------------------------------------------------------------------
// 6) CORREÇÃO DE REDAÇÃO ENEM
// ----------------------------------------------------------------------
// Avalia o texto do aluno seguindo a matriz de competências do ENEM.
// Sempre retorna evaluation completa: se a IA cair, fallback com nota 600
// e feedback genérico (texto suficiente). Garante que score nunca seja
// indevidamente 0.
//
// Critérios oficiais:
//   C1 — Demonstrar domínio da modalidade escrita formal da língua portuguesa
//   C2 — Compreender a proposta e aplicar conceitos das várias áreas de conhecimento
//   C3 — Selecionar, relacionar, organizar e interpretar informações,
//        fatos, opiniões e argumentos em defesa de um ponto de vista
//   C4 — Demonstrar conhecimento dos mecanismos linguísticos necessários
//        para a construção da argumentação
//   C5 — Elaborar proposta de intervenção para o problema abordado,
//        respeitando os direitos humanos
//
// Pontuação: 0, 40, 80, 120, 160 ou 200 por competência (total 0–1000).
// ----------------------------------------------------------------------

function normalizeEnemScore(n: any): number {
  const x = Math.max(0, Math.min(200, Math.round(Number(n) || 0)));
  // arredonda para o múltiplo de 40 mais próximo (padrão ENEM)
  return Math.round(x / 40) * 40;
}

export const evaluateEssay = async (
  title: string,
  essayText: string,
  instructions?: string
): Promise<EnemEssayEvaluation> => {
  const text = String(essayText || '').trim();

  // Fallback: texto muito curto, sem chamar IA
  if (text.length < 200) {
    const insufficient: EnemCompetency = {
      score: 0,
      feedback: 'Texto muito curto para avaliação por competência.',
    };
    return {
      c1: insufficient, c2: insufficient, c3: insufficient,
      c4: insufficient, c5: insufficient,
      totalScore: 0,
      score0to10: 0,
      generalComment: 'Redação muito curta. Desenvolva mais o texto para uma avaliação completa.',
      strengths: [],
      weaknesses: ['Texto abaixo do mínimo de extensão exigido.'],
      improvementTips: ['Desenvolva ao menos 25 linhas com introdução, desenvolvimento e conclusão.'],
    };
  }

  try {
    const prompt = `Você é um corretor experiente de redações do ENEM. Avalie a redação abaixo aplicando rigorosamente as 5 competências oficiais (cada uma de 0 a 200 pontos, em múltiplos de 40).

TEMA: "${title}"
${instructions ? `INSTRUÇÕES DADAS AO ALUNO: "${instructions}"` : ''}

REDAÇÃO DO ALUNO:
"""
${text}
"""

Avalie cada competência e devolva APENAS JSON neste formato exato:
{
  "c1": { "score": 0|40|80|120|160|200, "feedback": "comentário curto sobre domínio da norma culta (ortografia, concordância, regência, pontuação)" },
  "c2": { "score": 0|40|80|120|160|200, "feedback": "comentário sobre compreensão do tema e repertório sociocultural produtivo" },
  "c3": { "score": 0|40|80|120|160|200, "feedback": "comentário sobre seleção e organização de argumentos em defesa de um ponto de vista" },
  "c4": { "score": 0|40|80|120|160|200, "feedback": "comentário sobre conectivos, coesão referencial, coerência" },
  "c5": { "score": 0|40|80|120|160|200, "feedback": "comentário sobre proposta de intervenção (agente, ação, modo, finalidade, detalhamento) e respeito aos direitos humanos" },
  "generalComment": "balanço geral de 2-3 frases destacando o que mais marcou no texto",
  "strengths": ["ponto forte 1", "ponto forte 2"],
  "weaknesses": ["fragilidade 1", "fragilidade 2"],
  "improvementTips": ["dica prática 1", "dica prática 2", "dica prática 3"]
}

Regras importantes:
- Os scores são SEMPRE múltiplos de 40 (0, 40, 80, 120, 160 ou 200).
- Seja preciso e específico. Não invente trechos que não estão no texto.
- Em C5, atribua 0 se a proposta violar os direitos humanos; atribua até 200 só se houver agente + ação + modo/meio + finalidade + detalhamento.
- Em C1, considere desvios graves recorrentes como rebaixadores fortes.`;

    const raw = await withRetry(() => callDeepSeek(prompt, {
      model: 'deepseek-chat',
      json: true,
      temperature: 0.3,
      maxTokens: 4096,
      systemPrompt: 'Você é um corretor oficial de redação ENEM. Devolva APENAS JSON válido, sem markdown nem texto extra.',
    }));

    const parsed = extractJson<any>(raw);

    // Normalizar e validar
    const comp = (k: 'c1'|'c2'|'c3'|'c4'|'c5'): EnemCompetency => ({
      score: normalizeEnemScore(parsed?.[k]?.score),
      feedback: String(parsed?.[k]?.feedback || 'Sem comentário.').slice(0, 1200),
    });
    const c1 = comp('c1'), c2 = comp('c2'), c3 = comp('c3'), c4 = comp('c4'), c5 = comp('c5');
    const totalScore = c1.score + c2.score + c3.score + c4.score + c5.score;

    return {
      c1, c2, c3, c4, c5,
      totalScore,
      score0to10: Math.round((totalScore / 100) * 10) / 10,
      generalComment: String(parsed?.generalComment || 'Redação avaliada.').slice(0, 2000),
      strengths: Array.isArray(parsed?.strengths) ? parsed.strengths.slice(0, 5).map((s: any) => String(s).slice(0, 500)) : [],
      weaknesses: Array.isArray(parsed?.weaknesses) ? parsed.weaknesses.slice(0, 5).map((s: any) => String(s).slice(0, 500)) : [],
      improvementTips: Array.isArray(parsed?.improvementTips) ? parsed.improvementTips.slice(0, 5).map((s: any) => String(s).slice(0, 500)) : [],
    };
  } catch (err: any) {
    console.warn('[IA] Falha ao corrigir redação ENEM; aplicando fallback:', err);
    // Fallback: nota intermediária + sinaliza para o professor revisar
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const baseline: number = wordCount >= 200 ? 120 : 80;
    const fb: EnemCompetency = {
      score: baseline,
      feedback: 'Nota provisória — IA indisponível no momento. Aguarde revisão do professor.',
    };
    const totalScore = baseline * 5;
    return {
      c1: fb, c2: fb, c3: fb, c4: fb, c5: fb,
      totalScore,
      score0to10: Math.round((totalScore / 100) * 10) / 10,
      generalComment: `Redação recebida (${wordCount} palavras). A correção automática por IA está indisponível neste momento — o professor revisará e dará a nota final.`,
      strengths: [],
      weaknesses: [],
      improvementTips: ['Aguarde o feedback detalhado do professor.'],
    };
  }
};
