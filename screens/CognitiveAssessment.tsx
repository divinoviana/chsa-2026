// =====================================================================
// Avaliação Cognitiva CHSA — triagem de inteligência (CHC), superdotação
// (Renzulli) e neurodivergência (TDAH/TEA/Dislexia) em graus.
// Itens gerados proceduralmente por sessão (anti-decoreba), teste
// adaptativo, tempo por questão e modo anônimo.
// =====================================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
  Brain, Clock, ShieldCheck, Sparkles, ChevronRight, Loader2,
  AlertTriangle, CheckCircle2, EyeOff, User, Timer, ArrowLeft, Home,
} from 'lucide-react';
import {
  createRng, randomSeed, Rng, DomainKey, DOMAIN_INFO, PerfItem,
  Staircase, newStaircase, updateStaircase,
  makeMatrixItem, makeSeriesItem, makeRotationItem, makeAnalogyItem,
  makeSpanTrial, SpanTrial, spanToZ,
  makeSymbolTrial, SymbolTrial, symbolNetToZ,
  thetaToZ, compositeResult, classifyIcg, buildIntegrity, DomainScore,
} from '../services/cognitiveEngine';
import {
  buildQuestionnaire, LikertItem, LIKERT_LABELS, LEVEL_COLORS,
  scoreScreenings, scoreGiftedness, ScreeningResult, GiftednessResult,
} from '../services/cognitiveScreening';

// Ordem dos módulos de desempenho (MCQ adaptativos com nº de itens)
const MCQ_MODULES: { key: DomainKey; count: number }[] = [
  { key: 'matrizes', count: 7 },
  { key: 'series', count: 6 },
  { key: 'rotacao', count: 6 },
  { key: 'analogias', count: 7 },
];

type Phase =
  | 'intro' | 'setup' | 'moduleIntro' | 'mcq'
  | 'spanIntro' | 'spanShow' | 'spanInput'
  | 'symbolIntro' | 'symbol'
  | 'questIntro' | 'quest'
  | 'results';

interface FinalResult {
  icg: number; percentile: number; ci: [number, number];
  classification: ReturnType<typeof classifyIcg>;
  domains: DomainScore[];
  screenings: ScreeningResult[];
  giftedness: GiftednessResult;
  integrity: ReturnType<typeof buildIntegrity>;
  durationSec: number;
  anonCode: string | null;
  saved: boolean;
}

const genAnonCode = () => 'CHSA-' + Array.from({ length: 6 }, () =>
  'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');

export const CognitiveAssessment: React.FC = () => {
  const { student } = useAuth();

  const [phase, setPhase] = useState<Phase>('intro');
  const [anonymous, setAnonymous] = useState(false);
  const [age, setAge] = useState<string>('');

  // ------- infra do teste (refs para evitar closures velhas) -------
  const rngRef = useRef<Rng>(createRng(1));
  const stairsRef = useRef<Record<string, Staircase>>({});
  const analogiesUsedRef = useRef<Set<number>>(new Set());
  const rtLogRef = useRef<{ rtMs: number; domain: DomainKey }[]>([]);
  const timeoutsRef = useRef(0);
  const tabSwitchesRef = useRef(0);
  const startedAtRef = useRef(0);
  const itemStartRef = useRef(0);
  const answeredRef = useRef(false);

  // ------- MCQ -------
  const [moduleIdx, setModuleIdx] = useState(0);
  const [itemNum, setItemNum] = useState(0);
  const [item, setItem] = useState<PerfItem | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);

  // ------- Span de dígitos -------
  const spanRef = useRef({ backward: false, length: 4, fails: 0, bestF: 0, bestB: 0 });
  const [spanTrial, setSpanTrial] = useState<SpanTrial | null>(null);
  const [spanShowIdx, setSpanShowIdx] = useState(-1);
  const [spanInput, setSpanInput] = useState('');

  // ------- Busca de símbolos -------
  const [symTrial, setSymTrial] = useState<SymbolTrial | null>(null);
  const [symTime, setSymTime] = useState(90);
  const symScoreRef = useRef({ ok: 0, err: 0 });

  // ------- Questionário -------
  const [questItems, setQuestItems] = useState<LikertItem[]>([]);
  const [qIdx, setQIdx] = useState(0);
  const questAnswersRef = useRef<Record<string, number>>({});

  const [result, setResult] = useState<FinalResult | null>(null);
  const [saving, setSaving] = useState(false);

  // Monitor de integridade — conta saídas da aba durante o teste
  useEffect(() => {
    if (phase === 'intro' || phase === 'setup' || phase === 'results') return;
    const onVis = () => { if (document.visibilityState === 'hidden') tabSwitchesRef.current++; };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [phase]);

  // =================================================================
  // Fluxo
  // =================================================================
  const startTest = () => {
    const seed = randomSeed();
    rngRef.current = createRng(seed);
    stairsRef.current = { matrizes: newStaircase(), series: newStaircase(), rotacao: newStaircase(), analogias: newStaircase() };
    analogiesUsedRef.current = new Set();
    rtLogRef.current = [];
    timeoutsRef.current = 0;
    tabSwitchesRef.current = 0;
    symScoreRef.current = { ok: 0, err: 0 };
    spanRef.current = { backward: false, length: 4, fails: 0, bestF: 0, bestB: 0 };
    questAnswersRef.current = {};
    setQuestItems(buildQuestionnaire(rngRef.current));
    setQIdx(0);
    setModuleIdx(0);
    startedAtRef.current = Date.now();
    setPhase('moduleIntro');
  };

  const makeItem = useCallback((domain: DomainKey): PerfItem => {
    const rng = rngRef.current;
    const theta = stairsRef.current[domain]?.theta ?? 0;
    if (domain === 'matrizes') return makeMatrixItem(rng, theta);
    if (domain === 'series') return makeSeriesItem(rng, theta);
    if (domain === 'rotacao') return makeRotationItem(rng, theta);
    const it = makeAnalogyItem(rng, theta, analogiesUsedRef.current);
    return it || makeSeriesItem(rng, theta); // fallback improvável (pool esgotado)
  }, []);

  const beginMcqItem = (mIdx: number, iNum: number) => {
    const it = makeItem(MCQ_MODULES[mIdx].key);
    setItem(it);
    setItemNum(iNum);
    setTimeLeft(it.timeLimitSec);
    itemStartRef.current = Date.now();
    answeredRef.current = false;
    setPhase('mcq');
  };

  // Timer do item MCQ
  useEffect(() => {
    if (phase !== 'mcq' || !item) return;
    if (timeLeft <= 0) { handleAnswer(null); return; }
    const t = setTimeout(() => setTimeLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, timeLeft, item]);

  const handleAnswer = (optIdx: number | null) => {
    if (!item || answeredRef.current) return;
    answeredRef.current = true;
    const rtMs = Date.now() - itemStartRef.current;
    const correct = optIdx !== null && optIdx === item.correctIndex;
    if (optIdx === null) timeoutsRef.current++;
    const d = item.domain;
    stairsRef.current[d] = updateStaircase(stairsRef.current[d], item.difficulty, correct, rtMs);
    rtLogRef.current.push({ rtMs, domain: d });

    const mod = MCQ_MODULES[moduleIdx];
    if (itemNum + 1 < mod.count) {
      beginMcqItem(moduleIdx, itemNum + 1);
    } else if (moduleIdx + 1 < MCQ_MODULES.length) {
      setModuleIdx(moduleIdx + 1);
      setItemNum(0);
      setItem(null);
      setPhase('moduleIntro');
    } else {
      setPhase('spanIntro');
    }
  };

  // ------- Span -------
  const startSpanTrial = () => {
    const s = spanRef.current;
    const trial = makeSpanTrial(rngRef.current, s.length, s.backward);
    setSpanTrial(trial);
    setSpanShowIdx(0);
    setSpanInput('');
    setPhase('spanShow');
  };

  useEffect(() => {
    if (phase !== 'spanShow' || !spanTrial) return;
    if (spanShowIdx >= spanTrial.digits.length) {
      const t = setTimeout(() => { itemStartRef.current = Date.now(); setPhase('spanInput'); }, 300);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setSpanShowIdx(i => i + 1), 850);
    return () => clearTimeout(t);
  }, [phase, spanShowIdx, spanTrial]);

  const submitSpan = () => {
    if (!spanTrial) return;
    const s = spanRef.current;
    const expected = s.backward ? [...spanTrial.digits].reverse().join('') : spanTrial.digits.join('');
    const correct = spanInput.replace(/\D/g, '') === expected;
    rtLogRef.current.push({ rtMs: Date.now() - itemStartRef.current, domain: 'memoria' });

    if (correct) {
      if (s.backward) s.bestB = Math.max(s.bestB, s.length); else s.bestF = Math.max(s.bestF, s.length);
      s.length++; s.fails = 0;
    } else {
      s.fails++;
    }

    const phaseDone = s.fails >= 2 || s.length > 9;
    if (phaseDone && !s.backward) {
      spanRef.current = { ...s, backward: true, length: 3, fails: 0 };
      startSpanTrial();
    } else if (phaseDone && s.backward) {
      setPhase('symbolIntro');
    } else {
      startSpanTrial();
    }
  };

  // ------- Símbolos -------
  const startSymbol = () => {
    setSymTime(90);
    symScoreRef.current = { ok: 0, err: 0 };
    setSymTrial(makeSymbolTrial(rngRef.current));
    setPhase('symbol');
  };

  useEffect(() => {
    if (phase !== 'symbol') return;
    if (symTime <= 0) { setPhase('questIntro'); return; }
    const t = setTimeout(() => setSymTime(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, symTime]);

  const answerSymbol = (saysPresent: boolean) => {
    if (!symTrial) return;
    if (saysPresent === symTrial.present) symScoreRef.current.ok++; else symScoreRef.current.err++;
    setSymTrial(makeSymbolTrial(rngRef.current));
  };

  // ------- Questionário -------
  const answerQuest = (value: number) => {
    const it = questItems[qIdx];
    questAnswersRef.current[it.id] = value;
    if (qIdx + 1 < questItems.length) setQIdx(qIdx + 1);
    else finalize();
  };

  // ------- Finalização -------
  const finalize = async () => {
    setSaving(true);
    const s = spanRef.current;
    const domainZ: Partial<Record<DomainKey, number>> = {
      matrizes: thetaToZ(stairsRef.current.matrizes.theta),
      series: thetaToZ(stairsRef.current.series.theta),
      rotacao: thetaToZ(stairsRef.current.rotacao.theta),
      analogias: thetaToZ(stairsRef.current.analogias.theta),
      memoria: spanToZ(s.bestF || 3, s.bestB || 2),
      velocidade: symbolNetToZ(symScoreRef.current.ok - symScoreRef.current.err),
    };
    const comp = compositeResult(domainZ);
    const screenings = scoreScreenings(questAnswersRef.current, comp.domains);
    const giftedness = scoreGiftedness(comp.icg, questAnswersRef.current);
    const integrity = buildIntegrity(tabSwitchesRef.current, rtLogRef.current, timeoutsRef.current);
    const durationSec = Math.round((Date.now() - startedAtRef.current) / 1000);
    const anonCode = anonymous ? genAnonCode() : null;
    const classification = classifyIcg(comp.icg);

    let saved = false;
    try {
      const { error } = await supabase.from('cognitive_assessments').insert({
        student_id: anonymous ? null : (student?.id ?? null),
        student_name: anonymous ? null : (student?.name ?? null),
        anon_code: anonCode,
        is_anonymous: anonymous,
        age: age ? parseInt(age, 10) : null,
        grade: anonymous ? null : (student?.grade ?? null),
        school_class: anonymous ? null : (student?.school_class ?? null),
        icg: comp.icg,
        percentile: comp.percentile,
        classification: classification.label,
        domain_scores: comp.domains,
        giftedness,
        screenings,
        integrity,
        duration_seconds: durationSec,
      });
      saved = !error;
      if (error) console.error('[Cognitive] erro ao salvar:', error.message);
    } catch (e) {
      console.error('[Cognitive] erro ao salvar:', e);
    }

    setResult({
      icg: comp.icg, percentile: comp.percentile, ci: comp.ci, classification,
      domains: comp.domains, screenings, giftedness, integrity, durationSec, anonCode, saved,
    });
    setSaving(false);
    setPhase('results');
  };

  // =================================================================
  // Blocos visuais reutilizáveis
  // =================================================================
  const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <div className={`bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border dark:border-slate-800 rounded-[2rem] shadow-xl p-8 ${className}`}>
      {children}
    </div>
  );

  const TimerBar = ({ left, total }: { left: number; total: number }) => (
    <div className="flex items-center gap-3 mb-6">
      <Timer size={18} className={left <= 10 ? 'text-rose-500 animate-pulse' : 'text-slate-400'} />
      <div className="flex-1 h-2.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${left <= 10 ? 'bg-rose-500' : 'bg-gradient-to-r from-cyan-400 to-violet-500'}`}
          style={{ width: `${(left / total) * 100}%` }}
        />
      </div>
      <span className={`text-sm font-black tabular-nums w-10 text-right ${left <= 10 ? 'text-rose-500' : 'text-slate-500'}`}>{left}s</span>
    </div>
  );

  // =================================================================
  // Render por fase
  // =================================================================
  const wrap = (children: React.ReactNode) => (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 relative transition-colors">
      <div className="absolute inset-0 bg-mesh-bg opacity-40 dark:opacity-15 pointer-events-none" />
      <div className="container mx-auto px-4 py-10 max-w-3xl relative z-10">{children}</div>
    </div>
  );

  // ---------- INTRO ----------
  if (phase === 'intro') {
    return wrap(
      <Card>
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-3xl flex items-center justify-center text-white shadow-glow-purple"
               style={{ background: 'linear-gradient(135deg, #06B6D4 0%, #8B5CF6 60%, #FF3D8A 100%)' }}>
            <Brain size={32} />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tighter font-display">
              <span className="text-gradient-vibe">Avaliação Cognitiva CHSA</span>
            </h1>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mt-1">Triagem científica · CHC · Renzulli</p>
          </div>
        </div>

        <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          <p>
            Esta avaliação estima seu <strong>perfil cognitivo</strong> em 6 domínios do modelo
            CHC (o mais aceito pela ciência atual), triagem de <strong>superdotação</strong> pelo
            modelo dos Três Anéis de Renzulli e <strong>indicadores de neurodivergência</strong> (TDAH,
            TEA e dislexia) em graus.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(Object.keys(DOMAIN_INFO) as DomainKey[]).map(k => (
              <div key={k} className="p-3 rounded-2xl bg-slate-100 dark:bg-slate-800/60 text-center">
                <div className="text-2xl mb-1">{DOMAIN_INFO[k].emoji}</div>
                <div className="text-[11px] font-black uppercase tracking-wide">{DOMAIN_INFO[k].label}</div>
                <div className="text-[10px] text-slate-400 font-bold">{DOMAIN_INFO[k].chc}</div>
              </div>
            ))}
          </div>
          <ul className="space-y-2 text-xs">
            <li className="flex gap-2"><Sparkles size={14} className="text-violet-500 shrink-0 mt-0.5" /> <span><strong>Cada aplicação é única:</strong> as questões são geradas na hora por algoritmo — decorar ou pesquisar antes não funciona.</span></li>
            <li className="flex gap-2"><Clock size={14} className="text-cyan-500 shrink-0 mt-0.5" /> <span><strong>Tempo por questão:</strong> cada item tem cronômetro próprio. Duração total: 25–35 minutos, sem pausas.</span></li>
            <li className="flex gap-2"><EyeOff size={14} className="text-pink-500 shrink-0 mt-0.5" /> <span><strong>Modo anônimo disponível:</strong> nenhum dado pessoal é gravado; você recebe um código para consultar o resultado.</span></li>
            <li className="flex gap-2"><ShieldCheck size={14} className="text-emerald-500 shrink-0 mt-0.5" /> <span><strong>Isto é uma triagem, não um diagnóstico.</strong> Resultados fortes indicam a necessidade de avaliação formal com psicólogo/neuropsicólogo.</span></li>
          </ul>
          <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle size={14} className="inline mr-1 -mt-0.5" />
            Faça em um lugar tranquilo, sem interrupções. Sair da aba, usar calculadora ou pedir ajuda
            invalida o resultado (o sistema detecta e registra).
          </div>
        </div>

        <button
          onClick={() => setPhase('setup')}
          className="mt-8 w-full py-4 rounded-2xl text-white font-black uppercase tracking-widest text-sm shadow-glow-purple hover:scale-[1.02] transition-transform"
          style={{ background: 'linear-gradient(135deg, #06B6D4 0%, #8B5CF6 60%, #FF3D8A 100%)' }}
        >
          Começar <ChevronRight size={16} className="inline -mt-0.5" />
        </button>
        <Link to="/" className="block text-center mt-4 text-xs font-bold text-slate-400 hover:text-slate-600">
          <ArrowLeft size={12} className="inline -mt-0.5" /> Voltar ao portal
        </Link>
      </Card>
    );
  }

  // ---------- SETUP (identificação + idade) ----------
  if (phase === 'setup') {
    return wrap(
      <Card>
        <h2 className="text-xl font-black mb-6 font-display">Antes de começar</h2>
        <div className="space-y-6">
          <div>
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 block mb-3">Como você quer fazer?</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => setAnonymous(false)}
                disabled={!student}
                className={`p-4 rounded-2xl border-2 text-left transition-all ${!anonymous && student ? 'border-violet-500 bg-violet-50 dark:bg-violet-500/10' : 'border-slate-200 dark:border-slate-700'} ${!student ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                <User size={20} className="text-violet-500 mb-2" />
                <div className="font-black text-sm">Identificado</div>
                <div className="text-xs text-slate-500 mt-1">{student ? `Como ${student.name?.split(' ')[0]} — o professor poderá ver seu resultado.` : 'Requer login no portal.'}</div>
              </button>
              <button
                onClick={() => setAnonymous(true)}
                className={`p-4 rounded-2xl border-2 text-left transition-all ${anonymous ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-500/10' : 'border-slate-200 dark:border-slate-700'}`}
              >
                <EyeOff size={20} className="text-cyan-500 mb-2" />
                <div className="font-black text-sm">Anônimo</div>
                <div className="text-xs text-slate-500 mt-1">Sem nome, sem turma. Você recebe um código secreto com o resultado.</div>
              </button>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 block mb-3">
              Sua idade (usada só para calibrar as normas)
            </label>
            <div className="flex flex-wrap gap-2">
              {['12', '13', '14', '15', '16', '17', '18', '19', '20'].map(a => (
                <button key={a} onClick={() => setAge(a)}
                  className={`px-4 py-2.5 rounded-xl font-black text-sm transition-all ${age === a ? 'bg-gradient-vibe text-white shadow-glow-purple scale-105' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                  {a}
                </button>
              ))}
            </div>
          </div>
        </div>
        <button
          onClick={startTest}
          disabled={!age || (!anonymous && !student)}
          className="mt-8 w-full py-4 rounded-2xl text-white font-black uppercase tracking-widest text-sm shadow-glow-purple hover:scale-[1.02] transition-transform disabled:opacity-40 disabled:hover:scale-100"
          style={{ background: 'linear-gradient(135deg, #06B6D4 0%, #8B5CF6 60%, #FF3D8A 100%)' }}
        >
          Iniciar avaliação
        </button>
      </Card>
    );
  }

  // ---------- INTRO DE MÓDULO MCQ ----------
  if (phase === 'moduleIntro') {
    const mod = MCQ_MODULES[moduleIdx];
    const info = DOMAIN_INFO[mod.key];
    return wrap(
      <Card className="text-center">
        <div className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 mb-4">
          Módulo {moduleIdx + 1} de 6
        </div>
        <div className="text-6xl mb-4">{info.emoji}</div>
        <h2 className="text-2xl font-black font-display mb-2">{info.label}</h2>
        <p className="text-sm text-slate-500 max-w-md mx-auto mb-2">{info.desc}</p>
        <p className="text-xs text-slate-400 mb-8">{mod.count} questões · a dificuldade se ajusta ao seu desempenho · cronômetro por questão</p>
        <button
          onClick={() => beginMcqItem(moduleIdx, 0)}
          className="px-10 py-4 rounded-2xl text-white font-black uppercase tracking-widest text-sm shadow-glow-purple hover:scale-105 transition-transform"
          style={{ background: 'linear-gradient(135deg, #06B6D4 0%, #8B5CF6 100%)' }}
        >
          Estou pronto(a)
        </button>
      </Card>
    );
  }

  // ---------- ITEM MCQ ----------
  if (phase === 'mcq' && item) {
    const mod = MCQ_MODULES[moduleIdx];
    const info = DOMAIN_INFO[mod.key];
    return wrap(
      <Card>
        <div className="flex justify-between items-center mb-4">
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">{info.emoji} {info.label}</span>
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">{itemNum + 1} / {mod.count}</span>
        </div>
        <TimerBar left={timeLeft} total={item.timeLimitSec} />
        <h3 className="font-black text-lg mb-4">{item.prompt}</h3>

        {item.stimulusSvg && (
          <div className="max-w-xs mx-auto mb-6 text-slate-800 dark:text-slate-100"
               dangerouslySetInnerHTML={{ __html: item.stimulusSvg }} />
        )}
        {item.stimulusText && (
          <div className="text-center text-2xl font-black tracking-wide mb-8 py-6 rounded-2xl bg-slate-100 dark:bg-slate-800/60 tabular-nums">
            {item.stimulusText}
          </div>
        )}

        <div className={`grid gap-3 ${item.options[0]?.svg ? 'grid-cols-3 sm:grid-cols-5' : 'grid-cols-1 sm:grid-cols-2'}`}>
          {item.options.map((opt, i) => (
            <button
              key={i}
              onClick={() => handleAnswer(i)}
              className="p-3 rounded-2xl border-2 border-slate-200 dark:border-slate-700 hover:border-violet-500 hover:bg-violet-50 dark:hover:bg-violet-500/10 hover:scale-[1.03] transition-all text-slate-800 dark:text-slate-100"
            >
              {opt.svg
                ? <div className="w-full aspect-square" dangerouslySetInnerHTML={{ __html: opt.svg }} />
                : <span className="font-bold text-sm">{opt.text}</span>}
              <div className="text-[10px] font-black text-slate-400 mt-1.5">{String.fromCharCode(65 + i)}</div>
            </button>
          ))}
        </div>
      </Card>
    );
  }

  // ---------- SPAN: intro ----------
  if (phase === 'spanIntro') {
    return wrap(
      <Card className="text-center">
        <div className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 mb-4">Módulo 5 de 6</div>
        <div className="text-6xl mb-4">🧠</div>
        <h2 className="text-2xl font-black font-display mb-2">Memória de Trabalho</h2>
        <p className="text-sm text-slate-500 max-w-md mx-auto mb-2">
          Números vão aparecer <strong>um de cada vez</strong>. Memorize e digite a sequência completa.
          Na segunda parte, você digitará <strong>de trás para frente</strong>.
        </p>
        <p className="text-xs text-slate-400 mb-8">A sequência cresce enquanto você acerta. Errou duas seguidas, muda de fase.</p>
        <button
          onClick={startSpanTrial}
          className="px-10 py-4 rounded-2xl text-white font-black uppercase tracking-widest text-sm shadow-glow-purple hover:scale-105 transition-transform"
          style={{ background: 'linear-gradient(135deg, #06B6D4 0%, #8B5CF6 100%)' }}
        >
          Começar
        </button>
      </Card>
    );
  }

  // ---------- SPAN: exibição ----------
  if (phase === 'spanShow' && spanTrial) {
    return wrap(
      <Card className="text-center">
        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-8">
          🧠 Memorize {spanTrial.backward && <span className="text-pink-500">· responda DE TRÁS PARA FRENTE</span>}
        </div>
        <div className="h-40 flex items-center justify-center">
          <span key={spanShowIdx} className="text-8xl font-black text-gradient-vibe animate-[pulse_0.8s_ease-out]">
            {spanShowIdx < spanTrial.digits.length ? spanTrial.digits[spanShowIdx] : '·'}
          </span>
        </div>
        <div className="flex justify-center gap-2 mt-6">
          {spanTrial.digits.map((_, i) => (
            <div key={i} className={`w-2.5 h-2.5 rounded-full ${i <= spanShowIdx ? 'bg-violet-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
          ))}
        </div>
      </Card>
    );
  }

  // ---------- SPAN: resposta ----------
  if (phase === 'spanInput' && spanTrial) {
    return wrap(
      <Card className="text-center">
        <h3 className="font-black text-lg mb-2">
          Digite a sequência {spanTrial.backward ? <span className="text-pink-500">DE TRÁS PARA FRENTE</span> : 'na ordem em que apareceu'}
        </h3>
        <p className="text-xs text-slate-400 mb-6">{spanTrial.digits.length} números</p>
        <input
          autoFocus
          value={spanInput}
          onChange={e => setSpanInput(e.target.value.replace(/\D/g, '').slice(0, spanTrial.digits.length))}
          onKeyDown={e => { if (e.key === 'Enter' && spanInput.length === spanTrial.digits.length) submitSpan(); }}
          inputMode="numeric"
          className="text-center text-4xl font-black tracking-[0.4em] w-full max-w-sm mx-auto py-4 rounded-2xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none focus:border-violet-500 tabular-nums"
          placeholder={'•'.repeat(spanTrial.digits.length)}
        />
        <button
          onClick={submitSpan}
          disabled={spanInput.length !== spanTrial.digits.length}
          className="mt-6 px-10 py-3.5 rounded-2xl text-white font-black uppercase tracking-widest text-sm disabled:opacity-40 hover:scale-105 transition-transform"
          style={{ background: 'linear-gradient(135deg, #06B6D4 0%, #8B5CF6 100%)' }}
        >
          Confirmar
        </button>
      </Card>
    );
  }

  // ---------- SÍMBOLOS: intro ----------
  if (phase === 'symbolIntro') {
    return wrap(
      <Card className="text-center">
        <div className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 mb-4">Módulo 6 de 6</div>
        <div className="text-6xl mb-4">⚡</div>
        <h2 className="text-2xl font-black font-display mb-2">Velocidade de Processamento</h2>
        <p className="text-sm text-slate-500 max-w-md mx-auto mb-2">
          Você verá <strong>2 símbolos-alvo</strong> e uma fileira de 5 símbolos. Responda o mais rápido
          possível: <strong>algum dos alvos aparece na fileira?</strong>
        </p>
        <p className="text-xs text-slate-400 mb-8">Você tem 90 segundos para responder o máximo que conseguir. Erros descontam!</p>
        <button
          onClick={startSymbol}
          className="px-10 py-4 rounded-2xl text-white font-black uppercase tracking-widest text-sm shadow-glow-purple hover:scale-105 transition-transform"
          style={{ background: 'linear-gradient(135deg, #F59E0B 0%, #FF3D8A 100%)' }}
        >
          Valendo!
        </button>
      </Card>
    );
  }

  // ---------- SÍMBOLOS: jogo ----------
  if (phase === 'symbol' && symTrial) {
    return wrap(
      <Card>
        <TimerBar left={symTime} total={90} />
        <div className="text-center mb-8">
          <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-3">Símbolos-alvo</div>
          <div className="inline-flex gap-4 px-8 py-4 rounded-2xl bg-violet-50 dark:bg-violet-500/10 border-2 border-violet-300 dark:border-violet-500/40 text-4xl">
            {symTrial.targets.map((t, i) => <span key={i}>{t}</span>)}
          </div>
        </div>
        <div className="text-center mb-8">
          <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-3">A fileira contém algum alvo?</div>
          <div className="inline-flex gap-3 px-6 py-4 rounded-2xl bg-slate-100 dark:bg-slate-800/70 text-4xl">
            {symTrial.row.map((g, i) => <span key={i}>{g}</span>)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
          <button onClick={() => answerSymbol(true)}
            className="py-5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-white font-black text-xl uppercase tracking-widest hover:scale-[1.03] transition-all">
            Sim
          </button>
          <button onClick={() => answerSymbol(false)}
            className="py-5 rounded-2xl bg-rose-500 hover:bg-rose-400 text-white font-black text-xl uppercase tracking-widest hover:scale-[1.03] transition-all">
            Não
          </button>
        </div>
      </Card>
    );
  }

  // ---------- QUESTIONÁRIO: intro ----------
  if (phase === 'questIntro') {
    return wrap(
      <Card className="text-center">
        <div className="text-6xl mb-4">📋</div>
        <h2 className="text-2xl font-black font-display mb-2">Última etapa: autorrelato</h2>
        <p className="text-sm text-slate-500 max-w-md mx-auto mb-2">
          {questItems.length} afirmações sobre seu dia a dia. Responda com <strong>sinceridade</strong> —
          não existem respostas certas ou erradas, e é isso que permite identificar superdotação e
          neurodivergência.
        </p>
        <p className="text-xs text-slate-400 mb-8">Sem cronômetro nesta etapa. Leva ~5 minutos.</p>
        <button
          onClick={() => setPhase('quest')}
          className="px-10 py-4 rounded-2xl text-white font-black uppercase tracking-widest text-sm shadow-glow-purple hover:scale-105 transition-transform"
          style={{ background: 'linear-gradient(135deg, #10B981 0%, #06B6D4 100%)' }}
        >
          Responder
        </button>
      </Card>
    );
  }

  // ---------- QUESTIONÁRIO ----------
  if (phase === 'quest') {
    if (saving) {
      return wrap(
        <Card className="text-center py-16">
          <Loader2 size={40} className="animate-spin mx-auto text-violet-500 mb-4" />
          <p className="font-black">Calculando seu perfil cognitivo…</p>
        </Card>
      );
    }
    const it = questItems[qIdx];
    return wrap(
      <Card>
        <div className="flex justify-between items-center mb-2">
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">📋 Autorrelato</span>
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">{qIdx + 1} / {questItems.length}</span>
        </div>
        <div className="h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full mb-8 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-emerald-400 to-cyan-500 rounded-full transition-all" style={{ width: `${((qIdx + 1) / questItems.length) * 100}%` }} />
        </div>
        <p className="text-lg font-bold text-center min-h-[5rem] flex items-center justify-center mb-8">{it.text}</p>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {LIKERT_LABELS.map((lab, v) => (
            <button key={v} onClick={() => answerQuest(v)}
              className="py-3.5 px-2 rounded-2xl border-2 border-slate-200 dark:border-slate-700 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 hover:scale-[1.04] transition-all font-black text-xs uppercase tracking-wide">
              {lab}
            </button>
          ))}
        </div>
        {qIdx > 0 && (
          <button onClick={() => setQIdx(qIdx - 1)} className="mt-6 text-xs font-bold text-slate-400 hover:text-slate-600 mx-auto block">
            <ArrowLeft size={12} className="inline -mt-0.5" /> Corrigir anterior
          </button>
        )}
      </Card>
    );
  }

  // ---------- RESULTADOS ----------
  if (phase === 'results' && result) {
    const r = result;
    return wrap(
      <div className="space-y-6">
        <Card className="text-center">
          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 mb-4">Índice Cognitivo Geral (estimativa de triagem)</div>
          <div className="text-7xl font-black text-gradient-vibe font-display">{r.icg}</div>
          <div className={`text-lg font-black mt-2 ${r.classification.color}`}>{r.classification.label}</div>
          <p className="text-xs text-slate-400 mt-2">
            Intervalo provável: {r.ci[0]}–{r.ci[1]} · Percentil {r.percentile.toFixed(1)} (acima de ~{Math.round(r.percentile)}% das pessoas da sua idade)
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-4 max-w-lg mx-auto">{r.classification.note}</p>
          {r.integrity.validity !== 'ok' && (
            <div className={`mt-4 p-3 rounded-2xl text-xs font-bold ${r.integrity.validity === 'comprometida' ? 'bg-rose-50 dark:bg-rose-500/10 text-rose-600' : 'bg-amber-50 dark:bg-amber-500/10 text-amber-600'}`}>
              <AlertTriangle size={14} className="inline mr-1 -mt-0.5" />
              Validade {r.integrity.validity === 'comprometida' ? 'comprometida' : 'sob atenção'}: {r.integrity.notes.join(' ')}
            </div>
          )}
        </Card>

        <Card>
          <h3 className="font-black text-sm uppercase tracking-[0.2em] text-slate-400 mb-5">Perfil por domínio (CHC)</h3>
          <div className="space-y-4">
            {r.domains.map(d => {
              const info = DOMAIN_INFO[d.key];
              const pct = Math.max(4, Math.min(100, ((d.index - 55) / 90) * 100));
              return (
                <div key={d.key}>
                  <div className="flex justify-between text-xs font-bold mb-1.5">
                    <span>{info.emoji} {info.label} <span className="text-slate-400">({info.chc})</span></span>
                    <span className="tabular-nums">{d.index} · p{d.percentile.toFixed(0)}</span>
                  </div>
                  <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-violet-500 to-pink-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <h3 className="font-black text-sm uppercase tracking-[0.2em] text-slate-400 mb-2">🌟 Superdotação — Três Anéis de Renzulli</h3>
          <div className={`inline-block px-4 py-1.5 rounded-full text-white text-xs font-black uppercase tracking-widest mb-4 ${['bg-slate-400', 'bg-sky-500', 'bg-violet-500', 'bg-gradient-vibe shadow-glow-purple'][r.giftedness.level]}`}>
            {r.giftedness.levelLabel}
          </div>
          <div className="grid sm:grid-cols-3 gap-3 mb-4">
            {r.giftedness.rings.map((ring, i) => (
              <div key={i} className={`p-4 rounded-2xl border-2 text-center ${ring.high ? 'border-violet-400 bg-violet-50 dark:bg-violet-500/10' : 'border-slate-200 dark:border-slate-700'}`}>
                <div className="text-2xl font-black tabular-nums">{ring.value}<span className="text-xs text-slate-400 font-bold">/{ring.max}</span></div>
                <div className="text-[10px] font-black uppercase tracking-wide text-slate-500 mt-1">{ring.label}</div>
                {ring.high && <CheckCircle2 size={14} className="text-violet-500 mx-auto mt-1.5" />}
              </div>
            ))}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">{r.giftedness.note}</p>
        </Card>

        <Card>
          <h3 className="font-black text-sm uppercase tracking-[0.2em] text-slate-400 mb-5">🧭 Triagem de neurodivergência</h3>
          <div className="space-y-4">
            {r.screenings.map(s => (
              <div key={s.key} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <span className="font-black text-sm">{s.emoji} {s.label}</span>
                  <span className={`px-3 py-1 rounded-full text-white text-[10px] font-black uppercase tracking-widest ${LEVEL_COLORS[s.level]}`}>
                    {s.levelLabel}
                  </span>
                </div>
                <div className="flex gap-1 mb-2">
                  {[0, 1, 2, 3].map(l => (
                    <div key={l} className={`h-2 flex-1 rounded-full ${l <= s.level ? LEVEL_COLORS[s.level] : 'bg-slate-200 dark:bg-slate-700'}`} />
                  ))}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{s.note}</p>
              </div>
            ))}
          </div>
        </Card>

        {r.anonCode && (
          <Card className="text-center border-2 border-cyan-400/60">
            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 mb-2">Seu código anônimo — anote!</div>
            <div className="text-3xl font-black tracking-[0.2em] text-gradient-vibe font-mono">{r.anonCode}</div>
            <p className="text-xs text-slate-400 mt-2">É a única forma de vincular este resultado a você depois.</p>
          </Card>
        )}

        <Card className="text-xs text-slate-400 leading-relaxed">
          <strong className="text-slate-500 dark:text-slate-300">⚖️ Aviso importante:</strong> esta é uma ferramenta de <strong>triagem educacional</strong>,
          não um instrumento de diagnóstico. O ICG é uma estimativa com margem de erro (±7 pontos) e não substitui testes
          padronizados (WISC-V/WAIS-IV) aplicados por psicólogo. Indicadores "moderados" ou "expressivos" significam apenas
          que vale a pena buscar avaliação com profissional especializado — nunca um rótulo.
          {!r.saved && <span className="block mt-2 text-amber-500 font-bold">⚠️ O resultado não pôde ser salvo no servidor (mostrado apenas nesta tela).</span>}
          <span className="block mt-1">Duração: {Math.floor(r.durationSec / 60)}min {r.durationSec % 60}s.</span>
        </Card>

        <Link to="/" className="block">
          <button className="w-full py-4 rounded-2xl bg-slate-800 dark:bg-slate-800 text-white font-black uppercase tracking-widest text-sm hover:scale-[1.01] transition-transform">
            <Home size={14} className="inline -mt-0.5 mr-2" /> Voltar ao portal
          </button>
        </Link>
      </div>
    );
  }

  // fallback (transições)
  return wrap(
    <Card className="text-center py-16">
      <Loader2 size={40} className="animate-spin mx-auto text-violet-500" />
    </Card>
  );
};
