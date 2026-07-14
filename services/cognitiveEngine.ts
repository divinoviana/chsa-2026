// =====================================================================
// Motor Psicométrico CHSA — geração procedural de itens + teste adaptativo
// =====================================================================
// Base científica:
//  - Modelo CHC (Cattell-Horn-Carroll) de inteligência: amostra 6 domínios
//    (Gf matrizes, Gf séries, Gv rotação, Gc analogias, Gwm memória, Gs velocidade)
//  - Testagem adaptativa (CAT) com aproximação estocástica de Robbins-Monro
//    (staircase com passo decrescente) — o mesmo princípio dos CATs de IRT
//  - Itens fluid-reasoning no estilo Matrizes Progressivas de Raven,
//    gerados PROCEDURALMENTE com RNG semeado: cada aplicação é única,
//    tornando inútil decorar ou pesquisar itens antes.
//
// IMPORTANTE (honestidade psicométrica): o Índice Cognitivo Geral (ICG)
// produzido aqui é uma ESTIMATIVA de triagem calibrada internamente
// (M=100, DP=15), NÃO um QI clínico. Diagnóstico formal exige psicólogo
// com instrumentos padronizados (WISC-V/WAIS-IV, SON-R etc).
// =====================================================================

export type DomainKey = 'matrizes' | 'series' | 'rotacao' | 'analogias' | 'memoria' | 'velocidade';

export const DOMAIN_INFO: Record<DomainKey, { label: string; chc: string; emoji: string; desc: string }> = {
  matrizes:   { label: 'Raciocínio Matricial',   chc: 'Gf', emoji: '🧩', desc: 'Raciocínio fluido não-verbal — descobrir a regra que completa o padrão.' },
  series:     { label: 'Séries Numéricas',        chc: 'Gf/Gq', emoji: '🔢', desc: 'Raciocínio indutivo com números — identificar a lógica da sequência.' },
  rotacao:    { label: 'Rotação Mental',          chc: 'Gv', emoji: '🔄', desc: 'Processamento visuoespacial — girar figuras mentalmente.' },
  analogias:  { label: 'Analogias Verbais',       chc: 'Gc', emoji: '💬', desc: 'Compreensão verbal e raciocínio com relações entre conceitos.' },
  memoria:    { label: 'Memória de Trabalho',     chc: 'Gwm', emoji: '🧠', desc: 'Reter e manipular informação por curtos períodos.' },
  velocidade: { label: 'Velocidade de Processamento', chc: 'Gs', emoji: '⚡', desc: 'Rapidez e precisão em decisões visuais simples.' },
};

// ---------------------------------------------------------------------
// RNG semeado (mulberry32) — garante que cada sessão gere itens diferentes
// mas de forma reprodutível dentro da sessão (auditabilidade).
// ---------------------------------------------------------------------
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  try {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0];
  } catch {
    return Math.floor(Math.random() * 2 ** 32);
  }
}

const pick = <T,>(rng: Rng, arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const shuffle = <T,>(rng: Rng, arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const randInt = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

// ---------------------------------------------------------------------
// Staircase adaptativo (Robbins-Monro) — converge para o nível de
// habilidade θ em poucas tentativas, como um CAT simplificado.
// ---------------------------------------------------------------------
const STAIR_STEPS = [1.1, 0.9, 0.7, 0.55, 0.45, 0.38, 0.33, 0.3, 0.28, 0.26];

export interface Staircase {
  theta: number;
  n: number;
  history: { difficulty: number; correct: boolean; rtMs: number }[];
}

export const newStaircase = (): Staircase => ({ theta: 0, n: 0, history: [] });

export function updateStaircase(s: Staircase, difficulty: number, correct: boolean, rtMs: number): Staircase {
  const step = STAIR_STEPS[Math.min(s.n, STAIR_STEPS.length - 1)];
  return {
    theta: Math.max(-3, Math.min(3, s.theta + (correct ? step : -step))),
    n: s.n + 1,
    history: [...s.history, { difficulty, correct, rtMs }],
  };
}

// ---------------------------------------------------------------------
// Item de desempenho genérico (múltipla escolha)
// ---------------------------------------------------------------------
export interface PerfItem {
  domain: DomainKey;
  difficulty: number;           // escala logit aproximada (-2.5 .. +2.5)
  prompt: string;
  stimulusSvg?: string;         // matriz / figura principal
  stimulusText?: string;        // série numérica / analogia
  options: { svg?: string; text?: string }[];
  correctIndex: number;
  timeLimitSec: number;
}

// =====================================================================
// 1) MATRIZES (estilo Raven) — SVG procedural
// =====================================================================
type ShapeName = 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'cross';
const SHAPES: ShapeName[] = ['circle', 'square', 'triangle', 'diamond', 'star', 'cross'];

interface CellSpec { shape: ShapeName; count: number; size: number; rot: number; filled: boolean }

function shapePath(shape: ShapeName, s: number): string {
  const h = s / 2;
  switch (shape) {
    case 'circle':   return `M ${-h} 0 a ${h} ${h} 0 1 0 ${s} 0 a ${h} ${h} 0 1 0 ${-s} 0`;
    case 'square':   return `M ${-h} ${-h} h ${s} v ${s} h ${-s} Z`;
    case 'triangle': return `M 0 ${-h} L ${h} ${h} L ${-h} ${h} Z`;
    case 'diamond':  return `M 0 ${-h} L ${h} 0 L 0 ${h} L ${-h} 0 Z`;
    case 'star': {
      let d = '';
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? h : h * 0.45;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        d += `${i === 0 ? 'M' : 'L'} ${(r * Math.cos(a)).toFixed(1)} ${(r * Math.sin(a)).toFixed(1)} `;
      }
      return d + 'Z';
    }
    case 'cross': {
      const t = s * 0.18;
      return `M ${-t} ${-h} h ${2 * t} v ${h - t} h ${h - t} v ${2 * t} h ${-(h - t)} v ${h - t} h ${-2 * t} v ${-(h - t)} h ${-(h - t)} v ${-2 * t} h ${h - t} Z`;
    }
  }
}

function cellSvg(spec: CellSpec, px = 96): string {
  const positions: Record<number, [number, number][]> = {
    1: [[0, 0]],
    2: [[-0.28, 0], [0.28, 0]],
    3: [[-0.3, 0.22], [0.3, 0.22], [0, -0.28]],
    4: [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]],
  };
  const pos = positions[Math.min(spec.count, 4)] || positions[1];
  const scale = spec.count > 1 ? 0.55 : 1;
  const size = spec.size * scale * px * 0.36;
  const inner = pos.map(([dx, dy]) => {
    const cx = px / 2 + dx * px, cy = px / 2 + dy * px;
    return `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${spec.rot})"><path d="${shapePath(spec.shape, size)}" fill="${spec.filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="${Math.max(2, size * 0.09).toFixed(1)}" stroke-linejoin="round"/></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${px} ${px}" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">${inner}</svg>`;
}

const specKey = (c: CellSpec) => `${c.shape}|${c.count}|${c.size.toFixed(2)}|${c.rot}|${c.filled}`;

/**
 * Gera uma matriz 3×3 com k regras simultâneas variando (k cresce com a
 * dificuldade-alvo). A célula (3,3) é a resposta; distratores perturbam
 * 1-2 atributos da resposta correta.
 */
export function makeMatrixItem(rng: Rng, targetDifficulty: number): PerfItem {
  const k = targetDifficulty < -0.6 ? 1 : targetDifficulty < 0.6 ? 2 : 3;
  // Regras possíveis: cada atributo pode ser constante, variar por linha ou progredir por coluna
  const attrs = shuffle(rng, ['shape', 'count', 'size', 'rot', 'fill'] as const);
  const active = attrs.slice(0, k);

  const rowShapes = shuffle(rng, SHAPES).slice(0, 3);
  const baseShape = rowShapes[0];
  const rotStep = pick(rng, [45, 90]);
  const baseCount = randInt(rng, 1, 2);
  const sizes = [0.6, 0.8, 1.0];

  const grid: CellSpec[][] = [];
  for (let r = 0; r < 3; r++) {
    const row: CellSpec[] = [];
    for (let c = 0; c < 3; c++) {
      row.push({
        shape: active.includes('shape') ? rowShapes[r] : baseShape,
        count: active.includes('count') ? Math.min(4, baseCount + c) : baseCount,
        size: active.includes('size') ? sizes[c] : 0.85,
        rot: active.includes('rot') ? (r * 15 + c * rotStep) % 360 : 0,
        filled: active.includes('fill') ? ((r + c) % 2 === 0) : true,
      });
    }
    grid.push(row);
  }

  const answer = grid[2][2];
  const usedKeys = new Set<string>([specKey(answer)]);
  const distractors: CellSpec[] = [];
  let guard = 0;
  while (distractors.length < 4 && guard++ < 60) {
    const d: CellSpec = { ...answer };
    const nPerturb = rng() < 0.6 ? 1 : 2;
    for (let i = 0; i < nPerturb; i++) {
      const attr = pick(rng, ['shape', 'count', 'size', 'rot', 'fill'] as const);
      if (attr === 'shape') d.shape = pick(rng, SHAPES.filter(s => s !== d.shape));
      if (attr === 'count') d.count = Math.max(1, Math.min(4, d.count + (rng() < 0.5 ? 1 : -1)));
      if (attr === 'size')  d.size = pick(rng, sizes.filter(s => Math.abs(s - d.size) > 0.05));
      if (attr === 'rot')   d.rot = (d.rot + pick(rng, [45, 90, 135])) % 360;
      if (attr === 'fill')  d.filled = !d.filled;
    }
    if (!usedKeys.has(specKey(d))) {
      usedKeys.add(specKey(d));
      distractors.push(d);
    }
  }

  const opts = shuffle(rng, [answer, ...distractors]);
  const gridSvg = `<svg viewBox="0 0 312 312" xmlns="http://www.w3.org/2000/svg" width="100%">` +
    grid.flatMap((row, r) => row.map((cell, c) => {
      const x = c * 104 + 4, y = r * 104 + 4;
      if (r === 2 && c === 2) {
        return `<g transform="translate(${x} ${y})"><rect width="96" height="96" rx="12" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="6 5" opacity="0.5"/><text x="48" y="60" font-size="40" text-anchor="middle" fill="currentColor" opacity="0.5">?</text></g>`;
      }
      return `<g transform="translate(${x} ${y})"><rect width="96" height="96" rx="12" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"/><svg x="8" y="8" width="80" height="80" viewBox="0 0 96 96">${cellSvg(cell).replace(/<\/?svg[^>]*>/g, '')}</svg></g>`;
    })).join('') + `</svg>`;

  return {
    domain: 'matrizes',
    difficulty: k === 1 ? -1 + rng() * 0.6 : k === 2 ? -0.2 + rng() * 0.8 : 0.8 + rng() * 1.2,
    prompt: 'Qual figura completa o padrão?',
    stimulusSvg: gridSvg,
    options: opts.map(o => ({ svg: cellSvg(o) })),
    correctIndex: opts.indexOf(answer),
    timeLimitSec: 60,
  };
}

// =====================================================================
// 2) SÉRIES NUMÉRICAS — padrões gerados com dificuldade crescente
// =====================================================================
export function makeSeriesItem(rng: Rng, targetDifficulty: number): PerfItem {
  type Gen = { seq: number[]; next: number; difficulty: number };
  const gens: ((r: Rng) => Gen)[] = [
    // aritmética simples
    (r) => { const a = randInt(r, 2, 15), d = randInt(r, 2, 9); const s = [0, 1, 2, 3, 4].map(i => a + i * d); return { seq: s, next: a + 5 * d, difficulty: -1.4 }; },
    // aritmética decrescente
    (r) => { const a = randInt(r, 60, 99), d = randInt(r, 3, 9); const s = [0, 1, 2, 3, 4].map(i => a - i * d); return { seq: s, next: a - 5 * d, difficulty: -1.0 }; },
    // geométrica ×2 / ×3
    (r) => { const a = randInt(r, 2, 5), q = pick(r, [2, 3]); const s = [0, 1, 2, 3].map(i => a * q ** i); return { seq: s, next: a * q ** 4, difficulty: -0.3 }; },
    // alternada (duas séries intercaladas)
    (r) => {
      const a = randInt(r, 3, 12), d1 = randInt(r, 2, 6), b = randInt(r, 20, 40), d2 = randInt(r, 2, 6);
      const s = [a, b, a + d1, b - d2, a + 2 * d1, b - 2 * d2];
      return { seq: s, next: a + 3 * d1, difficulty: 0.4 };
    },
    // diferenças crescentes (quadrática)
    (r) => {
      const a = randInt(r, 1, 8), d0 = randInt(r, 2, 5), inc = randInt(r, 1, 3);
      const s = [a]; let d = d0;
      for (let i = 0; i < 4; i++) { s.push(s[s.length - 1] + d); d += inc; }
      return { seq: s.slice(0, 5), next: s[4] + d0 + 4 * inc, difficulty: 0.7 };
    },
    // aditiva tipo Fibonacci
    (r) => {
      const a = randInt(r, 1, 4), b = randInt(r, 2, 6);
      const s = [a, b]; for (let i = 0; i < 3; i++) s.push(s[s.length - 1] + s[s.length - 2]);
      return { seq: s, next: s[4] + s[3], difficulty: 1.0 };
    },
    // multiplicar e somar (x*2+c)
    (r) => {
      const c = randInt(r, 1, 4); const s = [randInt(r, 2, 5)];
      for (let i = 0; i < 3; i++) s.push(s[s.length - 1] * 2 + c);
      return { seq: s, next: s[3] * 2 + c, difficulty: 1.5 };
    },
  ];

  // filtra geradores próximos da dificuldade-alvo
  const near = gens
    .map(g => ({ g, sample: g(createRng(1)) }))
    .filter(x => Math.abs(x.sample.difficulty - targetDifficulty) < 1.1);
  const gen = (near.length ? pick(rng, near).g : pick(rng, gens));
  const { seq, next, difficulty } = gen(rng);

  const wrongs = new Set<number>();
  const lastDiff = next - seq[seq.length - 1];
  [next + 1, next - 1, next + lastDiff, next - lastDiff, next + 2, next + randInt(rng, 3, 8)]
    .forEach(w => { if (w !== next && wrongs.size < 3) wrongs.add(w); });
  const opts = shuffle(rng, [next, ...Array.from(wrongs).slice(0, 3)]);

  return {
    domain: 'series',
    difficulty,
    prompt: 'Qual é o próximo número da sequência?',
    stimulusText: seq.join('   →   ') + '   →   ?',
    options: opts.map(o => ({ text: String(o) })),
    correctIndex: opts.indexOf(next),
    timeLimitSec: 45,
  };
}

// =====================================================================
// 3) ROTAÇÃO MENTAL — poliominós SVG (Shepard & Metzler adaptado 2D)
// =====================================================================
type Cell = [number, number];

function normalizePoly(cells: Cell[]): string {
  const minX = Math.min(...cells.map(c => c[0]));
  const minY = Math.min(...cells.map(c => c[1]));
  return cells.map(c => `${c[0] - minX},${c[1] - minY}`).sort().join(';');
}
const rotatePoly = (cells: Cell[]): Cell[] => cells.map(([x, y]) => [y, -x] as Cell);
const mirrorPoly = (cells: Cell[]): Cell[] => cells.map(([x, y]) => [-x, y] as Cell);

function randomPolyomino(rng: Rng, n: number): Cell[] {
  const cells: Cell[] = [[0, 0]];
  const key = new Set(['0,0']);
  let guard = 0;
  while (cells.length < n && guard++ < 200) {
    const [bx, by] = pick(rng, cells);
    const [dx, dy] = pick(rng, [[1, 0], [-1, 0], [0, 1], [0, -1]] as Cell[]);
    const nx = bx + dx, ny = by + dy;
    if (!key.has(`${nx},${ny}`)) { key.add(`${nx},${ny}`); cells.push([nx, ny]); }
  }
  return cells;
}

/** Figura é quiral (espelho ≠ qualquer rotação)? Necessário para o item ter resposta única. */
function isChiral(cells: Cell[]): boolean {
  let m = mirrorPoly(cells);
  for (let i = 0; i < 4; i++) {
    if (normalizePoly(m) === normalizePoly(cells)) return false;
    // compara espelho com todas as rotações da original
    let r = cells;
    for (let j = 0; j < 4; j++) {
      if (normalizePoly(r) === normalizePoly(m)) return false;
      r = rotatePoly(r);
    }
    m = rotatePoly(m);
  }
  return true;
}

function polySvg(cells: Cell[], rotDeg: number): string {
  const minX = Math.min(...cells.map(c => c[0])), minY = Math.min(...cells.map(c => c[1]));
  const norm = cells.map(([x, y]) => [x - minX, y - minY]);
  const w = Math.max(...norm.map(c => c[0])) + 1, h = Math.max(...norm.map(c => c[1])) + 1;
  const u = 18;
  const rects = norm.map(([x, y]) =>
    `<rect x="${x * u}" y="${y * u}" width="${u}" height="${u}" fill="currentColor" stroke="var(--poly-stroke,#fff)" stroke-width="1.5" rx="2"/>`
  ).join('');
  const cx = (w * u) / 2, cy = (h * u) / 2;
  const pad = Math.max(w, h) * u * 0.75 + 8;
  return `<svg viewBox="${cx - pad} ${cy - pad} ${2 * pad} ${2 * pad}" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><g transform="rotate(${rotDeg} ${cx} ${cy})">${rects}</g></svg>`;
}

export function makeRotationItem(rng: Rng, targetDifficulty: number): PerfItem {
  const n = targetDifficulty < -0.4 ? 4 : targetDifficulty < 0.7 ? 5 : 6;
  let poly = randomPolyomino(rng, n);
  let guard = 0;
  while ((!isChiral(poly) || poly.length < n) && guard++ < 80) poly = randomPolyomino(rng, n);

  const correctRot = pick(rng, [90, 180, 270]);
  const mirror = mirrorPoly(poly);
  // 4 opções: correta (rotação), espelho rotacionado ×2, figura alterada
  const altered = [...poly];
  altered[altered.length - 1] = [altered[0][0] + 2, altered[0][1] + 2];
  const options = shuffle(rng, [
    { cells: poly, rot: correctRot, correct: true },
    { cells: mirror, rot: pick(rng, [0, 90]), correct: false },
    { cells: mirror, rot: pick(rng, [180, 270]), correct: false },
    { cells: randomPolyomino(rng, n), rot: pick(rng, [0, 90, 180]), correct: false },
  ]);

  return {
    domain: 'rotacao',
    difficulty: n === 4 ? -0.8 + rng() * 0.5 : n === 5 ? 0 + rng() * 0.6 : 0.9 + rng() * 0.8,
    prompt: 'Qual opção mostra a MESMA figura, apenas girada (sem espelhar)?',
    stimulusSvg: polySvg(poly, 0),
    options: options.map(o => ({ svg: polySvg(o.cells, o.rot) })),
    correctIndex: options.findIndex(o => o.correct),
    timeLimitSec: 45,
  };
}

// =====================================================================
// 4) ANALOGIAS VERBAIS — pool calibrado, amostrado sem repetição
// =====================================================================
interface AnalogyDef { a: string; b: string; c: string; answer: string; wrong: string[]; d: number }

const ANALOGY_POOL: AnalogyDef[] = [
  { a: 'Dia', b: 'Noite', c: 'Claro', answer: 'Escuro', wrong: ['Brilhante', 'Cedo', 'Frio'], d: -1.8 },
  { a: 'Pé', b: 'Sapato', c: 'Mão', answer: 'Luva', wrong: ['Anel', 'Braço', 'Dedo'], d: -1.7 },
  { a: 'Gato', b: 'Miado', c: 'Cachorro', answer: 'Latido', wrong: ['Osso', 'Coleira', 'Pata'], d: -1.8 },
  { a: 'Peixe', b: 'Água', c: 'Pássaro', answer: 'Ar', wrong: ['Ninho', 'Pena', 'Ovo'], d: -1.6 },
  { a: 'Quente', b: 'Frio', c: 'Alto', answer: 'Baixo', wrong: ['Grande', 'Largo', 'Pesado'], d: -1.8 },
  { a: 'Olho', b: 'Ver', c: 'Ouvido', answer: 'Ouvir', wrong: ['Falar', 'Sentir', 'Tocar'], d: -1.7 },
  { a: 'Abelha', b: 'Mel', c: 'Galinha', answer: 'Ovo', wrong: ['Pena', 'Milho', 'Ninho'], d: -1.5 },
  { a: 'Fome', b: 'Comer', c: 'Sede', answer: 'Beber', wrong: ['Suar', 'Correr', 'Dormir'], d: -1.6 },
  { a: 'Sol', b: 'Dia', c: 'Lua', answer: 'Noite', wrong: ['Estrela', 'Céu', 'Maré'], d: -1.5 },
  { a: 'Lápis', b: 'Escrever', c: 'Faca', answer: 'Cortar', wrong: ['Cozinhar', 'Afiar', 'Comer'], d: -1.3 },
  { a: 'Autor', b: 'Livro', c: 'Escultor', answer: 'Estátua', wrong: ['Museu', 'Pedra', 'Martelo'], d: -0.6 },
  { a: 'Termômetro', b: 'Temperatura', c: 'Relógio', answer: 'Tempo', wrong: ['Ponteiro', 'Pulso', 'Número'], d: -0.5 },
  { a: 'Célula', b: 'Tecido', c: 'Tijolo', answer: 'Parede', wrong: ['Cimento', 'Casa', 'Pedreiro'], d: -0.4 },
  { a: 'Raro', b: 'Comum', c: 'Escasso', answer: 'Abundante', wrong: ['Pequeno', 'Caro', 'Difícil'], d: -0.2 },
  { a: 'Medo', b: 'Coragem', c: 'Dúvida', answer: 'Certeza', wrong: ['Pergunta', 'Medo', 'Confusão'], d: -0.2 },
  { a: 'Trigo', b: 'Farinha', c: 'Uva', answer: 'Vinho', wrong: ['Parreira', 'Cacho', 'Fruta'], d: 0.0 },
  { a: 'Ator', b: 'Palco', c: 'Professor', answer: 'Sala de aula', wrong: ['Livro', 'Prova', 'Diploma'], d: -0.5 },
  { a: 'Semente', b: 'Árvore', c: 'Ovo', answer: 'Ave', wrong: ['Casca', 'Ninho', 'Galinheiro'], d: -0.3 },
  { a: 'Palavra', b: 'Frase', c: 'Nota musical', answer: 'Melodia', wrong: ['Instrumento', 'Ritmo', 'Cantor'], d: 0.1 },
  { a: 'Faminto', b: 'Comer', c: 'Exausto', answer: 'Descansar', wrong: ['Trabalhar', 'Suar', 'Acordar'], d: -0.1 },
  { a: 'Rio', b: 'Leito', c: 'Trem', answer: 'Trilho', wrong: ['Estação', 'Vagão', 'Viagem'], d: 0.0 },
  { a: 'Vacina', b: 'Prevenir', c: 'Remédio', answer: 'Curar', wrong: ['Receitar', 'Adoecer', 'Vender'], d: 0.1 },
  { a: 'Ilha', b: 'Água', c: 'Oásis', answer: 'Deserto', wrong: ['Palmeira', 'Camelo', 'Miragem'], d: 0.3 },
  { a: 'Efêmero', b: 'Duradouro', c: 'Frágil', answer: 'Resistente', wrong: ['Quebrado', 'Leve', 'Delicado'], d: 0.9 },
  { a: 'Míope', b: 'Visão', c: 'Surdo', answer: 'Audição', wrong: ['Ouvido', 'Silêncio', 'Voz'], d: 0.6 },
  { a: 'Arquipélago', b: 'Ilhas', c: 'Constelação', answer: 'Estrelas', wrong: ['Planetas', 'Céu', 'Galáxia'], d: 0.7 },
  { a: 'Ceticismo', b: 'Dúvida', c: 'Dogmatismo', answer: 'Certeza', wrong: ['Religião', 'Regra', 'Fé cega'], d: 1.4 },
  { a: 'Prólogo', b: 'Livro', c: 'Abertura', answer: 'Ópera', wrong: ['Porta', 'Discurso', 'Final'], d: 1.1 },
  { a: 'Anarquia', b: 'Governo', c: 'Silêncio', answer: 'Som', wrong: ['Paz', 'Biblioteca', 'Vazio'], d: 1.2 },
  { a: 'Filantropo', b: 'Generosidade', c: 'Avarento', answer: 'Mesquinhez', wrong: ['Riqueza', 'Pobreza', 'Economia'], d: 1.3 },
  { a: 'Hipótese', b: 'Teoria', c: 'Esboço', answer: 'Pintura', wrong: ['Lápis', 'Papel', 'Moldura'], d: 1.0 },
  { a: 'Verboso', b: 'Conciso', c: 'Pródigo', answer: 'Econômico', wrong: ['Rico', 'Generoso', 'Gastador'], d: 1.8 },
  { a: 'Etimologia', b: 'Palavras', c: 'Cartografia', answer: 'Mapas', wrong: ['Cartas', 'Viagens', 'Países'], d: 1.2 },
  { a: 'Insônia', b: 'Sono', c: 'Amnésia', answer: 'Memória', wrong: ['Cérebro', 'Sonho', 'Idade'], d: 0.8 },
  { a: 'Apogeu', b: 'Auge', c: 'Nadir', answer: 'Ponto mais baixo', wrong: ['Meio', 'Órbita', 'Ponto mais alto'], d: 1.9 },
  { a: 'Ubíquo', b: 'Onipresente', c: 'Efêmero', answer: 'Passageiro', wrong: ['Eterno', 'Raro', 'Invisível'], d: 1.9 },
  { a: 'Ostracismo', b: 'Exclusão', c: 'Anistia', answer: 'Perdão', wrong: ['Castigo', 'Lei', 'Exílio'], d: 1.7 },
  { a: 'Fotossíntese', b: 'Planta', c: 'Digestão', answer: 'Animal', wrong: ['Comida', 'Estômago', 'Energia'], d: 0.5 },
  { a: 'Sinfonia', b: 'Compositor', c: 'Constituição', answer: 'Legislador', wrong: ['Presidente', 'Juiz', 'Advogado'], d: 1.5 },
  { a: 'Bússola', b: 'Direção', c: 'Balança', answer: 'Peso', wrong: ['Justiça', 'Prato', 'Medida'], d: 0.2 },
  { a: 'Biblioteca', b: 'Livros', c: 'Pinacoteca', answer: 'Quadros', wrong: ['Fotos', 'Esculturas', 'Filmes'], d: 1.0 },
  { a: 'Otimista', b: 'Esperança', c: 'Pessimista', answer: 'Desânimo', wrong: ['Tristeza', 'Raiva', 'Inveja'], d: 0.3 },
];

export function makeAnalogyItem(rng: Rng, targetDifficulty: number, usedIdx: Set<number>): PerfItem | null {
  const candidates = ANALOGY_POOL
    .map((it, i) => ({ it, i }))
    .filter(x => !usedIdx.has(x.i))
    .sort((a, b) => Math.abs(a.it.d - targetDifficulty) - Math.abs(b.it.d - targetDifficulty))
    .slice(0, 5);
  if (!candidates.length) return null;
  const chosen = pick(rng, candidates);
  usedIdx.add(chosen.i);
  const { a, b, c, answer, wrong, d } = chosen.it;
  const opts = shuffle(rng, [answer, ...wrong]);
  return {
    domain: 'analogias',
    difficulty: d,
    prompt: 'Complete a analogia:',
    stimulusText: `${a} está para ${b}, assim como ${c} está para ... ?`,
    options: opts.map(o => ({ text: o })),
    correctIndex: opts.indexOf(answer),
    timeLimitSec: 40,
  };
}

// =====================================================================
// 5) MEMÓRIA DE TRABALHO — span de dígitos (direto e inverso)
// =====================================================================
export interface SpanTrial { digits: number[]; backward: boolean }

export function makeSpanTrial(rng: Rng, length: number, backward: boolean): SpanTrial {
  const digits: number[] = [];
  while (digits.length < length) {
    const d = randInt(rng, 0, 9);
    if (digits[digits.length - 1] !== d) digits.push(d); // evita repetição imediata
  }
  return { digits, backward };
}

/** Converte spans máximos (direto/inverso) em z-score aproximado (normas 14-18 anos). */
export function spanToZ(forwardSpan: number, backwardSpan: number): number {
  const zf = (forwardSpan - 6.2) / 1.2;
  const zb = (backwardSpan - 4.4) / 1.2;
  return Math.max(-3, Math.min(3, (zf + zb) / 2));
}

// =====================================================================
// 6) VELOCIDADE DE PROCESSAMENTO — busca de símbolos (90s)
// =====================================================================
const GLYPHS = ['◐', '◑', '◒', '◓', '◧', '◨', '⬒', '⬓', '◩', '◪', '⬖', '⬗', '✦', '✧', '◆', '◇', '▲', '△', '⬟', '⬠'];

export interface SymbolTrial { targets: string[]; row: string[]; present: boolean }

export function makeSymbolTrial(rng: Rng): SymbolTrial {
  const pool = shuffle(rng, GLYPHS);
  const targets = pool.slice(0, 2);
  const others = pool.slice(2);
  const present = rng() < 0.5;
  const row = shuffle(rng, others).slice(0, 5);
  if (present) row[randInt(rng, 0, 4)] = pick(rng, targets);
  return { targets, row, present };
}

/** Net score (acertos − erros) em 90s → z. Normas internas plausíveis p/ adolescentes. */
export function symbolNetToZ(net: number): number {
  return Math.max(-3, Math.min(3, (net - 30) / 9));
}

// =====================================================================
// Escore composto — ICG (M=100, DP=15) com IC de 90%
// =====================================================================
export function thetaToZ(theta: number): number {
  // O staircase converge para o θ do sujeito na escala de dificuldade dos
  // itens; calibração interna: θ=0 ≈ desempenho mediano de 15-16 anos.
  return Math.max(-3, Math.min(3, theta / 1.15));
}

export function normalCdf(z: number): number {
  // aproximação de Zelen & Severo
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}

export interface DomainScore { key: DomainKey; z: number; index: number; percentile: number }

export function compositeResult(domainZ: Partial<Record<DomainKey, number>>) {
  const weights: Record<DomainKey, number> = {
    matrizes: 0.24, series: 0.15, rotacao: 0.15, analogias: 0.16, memoria: 0.15, velocidade: 0.15,
  };
  let wsum = 0, zsum = 0;
  const domains: DomainScore[] = [];
  (Object.keys(weights) as DomainKey[]).forEach(k => {
    const z = domainZ[k];
    if (z === undefined || Number.isNaN(z)) return;
    wsum += weights[k]; zsum += z * weights[k];
    domains.push({ key: k, z, index: Math.round(100 + 15 * z), percentile: Math.round(normalCdf(z) * 1000) / 10 });
  });
  // Correção de atenuação leve: compostos têm DP maior que a média das partes
  const zc = wsum > 0 ? (zsum / wsum) * 1.12 : 0;
  const icg = Math.max(55, Math.min(150, Math.round(100 + 15 * zc)));
  const percentile = Math.round(normalCdf(zc) * 1000) / 10;
  return { icg, zComposite: zc, percentile, ci: [Math.max(55, icg - 7), Math.min(150, icg + 7)] as [number, number], domains };
}

export function classifyIcg(icg: number): { label: string; color: string; note: string } {
  if (icg >= 130) return { label: 'Muito Superior', color: 'text-violet-500', note: 'Faixa associada a altas habilidades/superdotação (≥ 2 DP). Recomenda-se avaliação formal com psicólogo.' };
  if (icg >= 120) return { label: 'Superior', color: 'text-indigo-500', note: 'Desempenho bem acima da média (top ~9%).' };
  if (icg >= 110) return { label: 'Média Superior', color: 'text-sky-500', note: 'Desempenho acima da média.' };
  if (icg >= 90)  return { label: 'Média', color: 'text-emerald-500', note: 'Desempenho na faixa média — onde está a maioria das pessoas.' };
  if (icg >= 80)  return { label: 'Média Inferior', color: 'text-amber-500', note: 'Levemente abaixo da média — pode refletir cansaço, ansiedade ou desatenção no teste.' };
  if (icg >= 70)  return { label: 'Limítrofe', color: 'text-orange-500', note: 'Abaixo da média. Se persistir em reavaliação, vale investigação profissional.' };
  return { label: 'Muito Abaixo da Média', color: 'text-red-500', note: 'Resultado exige cautela: refaça em ambiente tranquilo e procure avaliação profissional.' };
}

// =====================================================================
// Validade / integridade da aplicação
// =====================================================================
export interface IntegrityReport {
  tabSwitches: number;
  fastResponses: number;    // respostas < 2s em itens de raciocínio (chute)
  timeouts: number;
  validity: 'ok' | 'atencao' | 'comprometida';
  notes: string[];
}

export function buildIntegrity(tabSwitches: number, allRts: { rtMs: number; domain: DomainKey }[], timeouts: number): IntegrityReport {
  const reasoning = allRts.filter(r => r.domain !== 'velocidade' && r.domain !== 'memoria');
  const fast = reasoning.filter(r => r.rtMs < 2000).length;
  const notes: string[] = [];
  if (tabSwitches > 2) notes.push(`Saiu da aba ${tabSwitches}× durante o teste.`);
  if (fast >= 5) notes.push(`${fast} respostas em menos de 2s sugerem chute aleatório.`);
  if (timeouts >= 6) notes.push(`${timeouts} questões expiraram sem resposta.`);
  const validity: IntegrityReport['validity'] =
    fast >= 8 || tabSwitches > 6 ? 'comprometida' : (fast >= 5 || tabSwitches > 2 || timeouts >= 6) ? 'atencao' : 'ok';
  return { tabSwitches, fastResponses: fast, timeouts, validity, notes };
}
