
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { subjectsInfo } from '../data';
import { Subject } from '../types';
import { ArrowLeft, BrainCircuit, CheckCircle2, Clock, Send, Loader2, Award, Info, Lock, AlertTriangle, Pencil, ShieldAlert } from 'lucide-react';
import { VisualActivityRenderer } from '../components/VisualActivityRenderer';
import { useIntegrityMonitor, SuspicionBadge } from '../lib/useIntegrityMonitor';

// ── Seeded shuffle utilities ──────────────────────────────────────────────────
function seededRandom(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(31, h) + seed.charCodeAt(i) | 0; }
  let s = Math.abs(h) || 1;
  return () => { s = Math.imul(s ^ (s >>> 15), s | 1); s ^= s + Math.imul(s ^ (s >>> 7), s | 61); return ((s ^ (s >>> 14)) >>> 0) / 0x100000000; };
}
function seededShuffle<T>(arr: T[], seed: string): T[] {
  const a = [...arr]; const r = seededRandom(seed);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function shuffleExamForStudent(examData: any, studentId: string): any {
  if (!examData?.questions || !studentId) return examData;
  const seed = studentId;
  const shuffledQs = seededShuffle([...examData.questions], seed);
  const processedQs = shuffledQs.map((q: any, qi: number) => {
    if (q.type === 'discursive' || !q.options || !q.correctOption) return q;
    const letters = ['a','b','c','d','e'].filter((l: string) => q.options[l]);
    const shuffledLetters = seededShuffle(letters, seed + String(q.id) + qi);
    const newOptions: any = {};
    let newCorrectOption = q.correctOption;
    shuffledLetters.forEach((oldLetter: string, idx: number) => {
      const newLetter = letters[idx];
      newOptions[newLetter] = q.options[oldLetter];
      if (oldLetter === q.correctOption) newCorrectOption = newLetter;
    });
    return { ...q, options: newOptions, correctOption: newCorrectOption };
  });
  return { ...examData, questions: processedQs };
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export const EvaluationView: React.FC = () => {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const { student, isLoading: isAuthLoading } = useAuth();

  const [exam, setExam] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [score, setScore] = useState(0);
  const [alreadyDone, setAlreadyDone] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const {
    tabSwitches, pasteAttempts, extensionDetected, programmaticInputs,
    suspicionLevel, handleKeyDown, handlePaste, handleInput, attachTextareaMonitor, getIntegrityData,
  } = useIntegrityMonitor(!isFinished && !checkingStatus && !!exam);
  const [shuffledExam, setShuffledExam] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState(30 * 60);
  const [isAnnulled, setIsAnnulled] = useState(false);
  const skipConfirmRef = useRef(false);
  const autoSubmittedRef = useRef(false);

  // Resultado da correção IA da redação (5 competências ENEM)
  const [essayCorrection, setEssayCorrection] = useState<any | null>(null);
  // Loading específico para mostrar "Corrigindo redação…" durante a chamada IA
  const [isCorrectingEssay, setIsCorrectingEssay] = useState(false);
  const isEssay = exam?.type === 'essay' || (exam?.questions?.[0]?.type === 'essay');

  useEffect(() => {
    if (!isAuthLoading && !student) {
      navigate('/login');
    } else if (examId && student) {
      checkAttemptAndFetchExam();
    }
  }, [examId, student, isAuthLoading]);

  // Set shuffled exam after exam loads (non-essay only)
  useEffect(() => {
    if (!exam || !student?.id) return;
    const examIsEssay = exam?.type === 'essay' || (exam?.questions?.[0]?.type === 'essay');
    if (!examIsEssay) setShuffledExam(shuffleExamForStudent(exam, student.id));
  }, [exam?.id, student?.id]);

  // Countdown timer (simulado only, 30 min)
  useEffect(() => {
    if (isFinished || checkingStatus || !exam || isAnnulled) return;
    const examIsEssay = exam?.type === 'essay' || (exam?.questions?.[0]?.type === 'essay');
    if (examIsEssay) return;
    if (timeLeft <= 0) return;
    const id = setTimeout(() => setTimeLeft(t => Math.max(0, t - 1)), 1000);
    return () => clearTimeout(id);
  }, [timeLeft, isFinished, checkingStatus, exam?.id, isAnnulled]);

  // Auto-submit when timer hits 0
  useEffect(() => {
    const examIsEssay = exam?.type === 'essay' || (exam?.questions?.[0]?.type === 'essay');
    if (timeLeft === 0 && !isFinished && !isAnnulled && !!exam && !examIsEssay && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      skipConfirmRef.current = true;
      handleSubmit();
    }
  }, [timeLeft]);

  // Violation annulment (simulado only)
  useEffect(() => {
    const examIsEssay = exam?.type === 'essay' || (exam?.questions?.[0]?.type === 'essay');
    if (isFinished || isAnnulled || !exam || examIsEssay) return;
    const totalViolations = tabSwitches + pasteAttempts + programmaticInputs;
    if (totalViolations >= 10) handleAnnulExam();
  }, [tabSwitches, pasteAttempts, programmaticInputs]);

  const handleAnnulExam = async () => {
    if (isFinished || isAnnulled || !exam || !student) return;
    setIsAnnulled(true);
    setIsFinished(true);
    try {
      const nowIso = new Date().toISOString();
      const examTitle = exam.title || `Avaliação Bimestral: ${exam.bimester}º Bimestre`;
      await supabase.from('submissions').insert({
        student_id: student.id,
        student_name: student.name.trim(),
        school_class: student.school_class.trim(),
        grade: student.grade,
        lesson_id: examId,
        lesson_title: examTitle.trim(),
        subject: exam.subject,
        score: 0,
        content: [],
        ai_feedback: {
          generalComment: `Prova ANULADA por excesso de infrações (${tabSwitches + pasteAttempts + programmaticInputs}/10). Saídas de tela: ${tabSwitches}. Tentativas de colar: ${pasteAttempts}. Inserções automáticas: ${programmaticInputs}.`,
          corrections: [],
          integrity: getIntegrityData(),
          annulled: true,
        },
        teacher_feedback: null,
        submitted_at: nowIso,
        submission_date: nowIso,
        status: 'annulled',
      });
    } catch (e) {
      console.error('Erro ao registrar prova anulada:', e);
    }
  };

  const checkAttemptAndFetchExam = async () => {
    if (!examId || !student) return;
    setCheckingStatus(true);
    try {
      const { data: examData, error: examErr } = await supabase
        .from('bimonthly_exams')
        .select('*')
        .eq('id', examId)
        .maybeSingle();
      if (examErr) throw examErr;
      if (!examData) {
        alert("Avaliação não encontrada.");
        navigate('/');
        return;
      }
      setExam(examData);

      // Detecta tipo (redação vs simulado) e monta o título esperado da submissão
      const isEssayExam = examData.type === 'essay' || (examData.questions?.[0]?.type === 'essay');
      const expectedTitle = isEssayExam
        ? `Redação: ${(examData.title || 'Redação').trim()}`
        : (examData.title?.trim() || `Avaliação Bimestral: ${examData.bimester}º Bimestre`);

      // Checa por submissão prévia: tenta pelo lesson_id do exame (mais confiável);
      // se nada, fallback pelo título.
      let existing: any[] | null = null;
      const r1 = await supabase
        .from('submissions')
        .select('score')
        .eq('student_id', student.id)
        .eq('lesson_id', examId!)
        .limit(1);
      if (!r1.error && r1.data && r1.data.length > 0) {
        existing = r1.data;
      } else {
        const r2 = await supabase
          .from('submissions')
          .select('score')
          .eq('student_id', student.id)
          .eq('subject', examData.subject)
          .eq('lesson_title', expectedTitle)
          .limit(1);
        if (r2.error) throw r2.error;
        existing = r2.data;
      }

      if (existing && existing.length > 0) {
        setScore(existing[0].score ?? 0);
        setAlreadyDone(true);
        setIsFinished(true);
      }
    } catch (e: any) {
      console.error('Erro ao validar tentativa:', e);
    } finally {
      setCheckingStatus(false);
    }
  };

  const handleOptionSelect = (questionId: number, option: string) => {
    if (isFinished) return;
    setAnswers(prev => ({ ...prev, [questionId]: option }));
  };

  // Submissão de Redação: chama a IA pra corrigir no padrão ENEM
  // (5 competências × 200 = 1000 pts → escala 0-10) e grava tudo no banco.
  const handleSubmitEssay = async () => {
    const essayText = String(answers[1] || '').trim();
    if (essayText.length < 200) {
      alert('Sua redação está muito curta (mínimo de 200 caracteres). Desenvolva mais o texto.');
      return;
    }
    if (!confirm('Tem certeza que quer enviar? Você só tem UMA tentativa para esta redação.')) return;
    setIsSubmitting(true);
    try {
      const nowIso = new Date().toISOString();
      const title = exam.title || 'Redação';
      const instructions = exam.questions?.[0]?.instructions || '';
      const wordCount = essayText.split(/\s+/).filter(Boolean).length;
      const charCount = essayText.length;

      // 1) Chama a IA pra corrigir no padrão ENEM
      let enemEval: any = null;
      setIsCorrectingEssay(true);
      try {
        const { evaluateEssay } = await import('../services/aiService');
        enemEval = await evaluateEssay(title, essayText, instructions);
      } catch (e) {
        console.warn('Falha na correção IA da redação; gravando sem correção:', e);
      } finally {
        setIsCorrectingEssay(false);
      }

      const finalScore = enemEval?.score0to10 || 0;
      setScore(finalScore);
      setEssayCorrection(enemEval || null);

      const integrityData = getIntegrityData();
      const generalComment = enemEval
        ? `${enemEval.generalComment} (Total: ${enemEval.totalScore}/1000)` +
          ` · Aluno saiu da tela ${tabSwitches}× e tentou colar ${pasteAttempts}×.`
        : `Redação enviada. ${wordCount} palavras, ${charCount} caracteres. ` +
          `Aluno saiu da tela ${tabSwitches}× e tentou colar texto externo ${pasteAttempts}×.`;

      const { error } = await supabase.from('submissions').insert({
        student_id: student.id,
        student_name: student.name.trim(),
        school_class: student.school_class.trim(),
        grade: student.grade,
        lesson_id: examId,
        lesson_title: `Redação: ${title}`,
        subject: exam.subject,
        score: finalScore,
        content: [{
          question: title,
          answer: essayText,
          tab_switches: tabSwitches,
          paste_attempts: pasteAttempts,
          word_count: wordCount,
          char_count: charCount,
        }],
        ai_feedback: {
          type: 'essay_enem',
          generalComment,
          corrections: [],
          enem: enemEval || null,
          integrity: integrityData,
        },
        teacher_feedback: null,
        submitted_at: nowIso,
        submission_date: nowIso,
        status: enemEval ? 'graded' : 'pending',
      });
      if (error) throw error;
      setIsFinished(true);
    } catch (err: any) {
      alert('Falha ao enviar redação: ' + (err?.message || 'tente novamente.'));
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    // Redação: caminho próprio (sem corrigir)
    if (isEssay) return handleSubmitEssay();

    // Conta quantas questões devem ter resposta (todas as do exam)
    const activeQs = (shuffledExam || exam).questions;
    const totalQuestions = activeQs.length;
    const answeredCount = activeQs.filter((q: any) => {
      const v = answers[q.id];
      return v !== undefined && v !== null && String(v).trim() !== '';
    }).length;

    if (answeredCount < totalQuestions) {
      alert(`Responda todas as ${totalQuestions} questões antes de finalizar. (${answeredCount}/${totalQuestions})`);
      return;
    }

    const shouldConfirm = !skipConfirmRef.current;
    skipConfirmRef.current = false;
    if (shouldConfirm && !confirm("Tem certeza que deseja enviar? Você só tem UMA tentativa para esta avaliação.")) return;

    setIsSubmitting(true);

    // 1) Corrige OBJETIVAS localmente (precisão 100%)
    const objectiveQs = activeQs.filter((q: any) => q.type !== 'discursive' && q.options && q.correctOption);
    const discursiveQs = activeQs.filter((q: any) => q.type === 'discursive' || !q.options || !q.correctOption);

    let objectiveCorrect = 0;
    const correctionDetails: any[] = [];

    objectiveQs.forEach((q: any) => {
      const studentLetter = String(answers[q.id] || '').toLowerCase();
      const correctLetter = String(q.correctOption || '').toLowerCase();
      const isCorrect = studentLetter === correctLetter;
      if (isCorrect) objectiveCorrect++;
      correctionDetails.push({
        questionId: q.id,
        type: 'objective',
        question: q.questionText,
        studentAnswer: `Opção ${studentLetter.toUpperCase()}: ${q.options?.[studentLetter] || ''}`,
        correctAnswer: `Opção ${correctLetter.toUpperCase()}: ${q.options?.[correctLetter] || ''}`,
        isCorrect,
        score: isCorrect ? 10 : 0,
        feedback: isCorrect ? 'Correto.' : `A alternativa correta era ${correctLetter.toUpperCase()}.`,
      });
    });

    // 2) Corrige DISCURSIVAS via IA (com fallback se IA cair)
    let aiGeneralComment: string | null = null;
    let discursiveTotalScore = 0;
    if (discursiveQs.length > 0) {
      try {
        const { evaluateActivities } = await import('../services/aiService');
        const aiInput = discursiveQs.map((q: any) => ({
          question: q.questionText,
          answer: String(answers[q.id] || ''),
          // sem correctAnswer → força a IA a avaliar densidade conceitual
        }));
        const aiRes = await evaluateActivities(
          `${exam.title || 'Simulado Bimestral'} (${exam.bimester}º Bimestre)`,
          (exam.topics || []).join(', '),
          aiInput
        );
        aiGeneralComment = aiRes.generalComment;
        aiRes.corrections.forEach((c, i) => {
          const q = discursiveQs[i];
          discursiveTotalScore += Number(c.score) || 0;
          correctionDetails.push({
            questionId: q?.id,
            type: 'discursive',
            question: c.question,
            studentAnswer: c.studentAnswer,
            isCorrect: c.isCorrect,
            score: c.score,
            feedback: c.feedback,
          });
        });
      } catch (e) {
        console.warn('IA falhou nas discursivas; aplicando fallback:', e);
        discursiveQs.forEach((q: any) => {
          const ans = String(answers[q.id] || '').trim();
          const score = ans.length >= 30 ? 6 : 0;
          discursiveTotalScore += score;
          correctionDetails.push({
            questionId: q.id,
            type: 'discursive',
            question: q.questionText,
            studentAnswer: ans || '(não respondida)',
            isCorrect: score >= 6,
            score,
            feedback: score >= 6
              ? 'Resposta registrada. Aguardando avaliação detalhada do professor.'
              : 'Resposta muito breve ou ausente. O professor irá revisar.',
          });
        });
      }
    }

    // 3) Calcula nota final 0–10 considerando objetivas + discursivas
    const objectiveScoreAvg = objectiveQs.length > 0 ? (objectiveCorrect / objectiveQs.length) * 10 : 0;
    const discursiveScoreAvg = discursiveQs.length > 0 ? (discursiveTotalScore / discursiveQs.length) : 0;

    let finalScore: number;
    if (objectiveQs.length > 0 && discursiveQs.length > 0) {
      // Peso proporcional ao número de questões de cada tipo
      const totalQ = objectiveQs.length + discursiveQs.length;
      finalScore = (objectiveScoreAvg * objectiveQs.length + discursiveScoreAvg * discursiveQs.length) / totalQ;
    } else if (objectiveQs.length > 0) {
      finalScore = objectiveScoreAvg;
    } else {
      finalScore = discursiveScoreAvg;
    }
    finalScore = Math.round(finalScore * 10) / 10; // 1 casa decimal
    setScore(finalScore);

    const integrityData = getIntegrityData();
    const baseComment = aiGeneralComment ||
      `Simulado finalizado. Objetivas: ${objectiveCorrect}/${objectiveQs.length} acertos. Discursivas: nota média ${discursiveScoreAvg.toFixed(1)}.`;
    const integrityNote = (tabSwitches > 0 || pasteAttempts > 0 || extensionDetected || programmaticInputs > 0)
      ? ` ⚠️ Integridade: ${tabSwitches} saída(s) de tela, ${pasteAttempts} tentativa(s) de colar${extensionDetected ? ', extensão detectada' : ''}${programmaticInputs > 0 ? `, ${programmaticInputs} inserção(ões) programática(s)` : ''}.`
      : '';
    const generalComment = baseComment + integrityNote;

    try {
      const nowIso = new Date().toISOString();
      const examTitle = exam.title || `Avaliação Bimestral: ${exam.bimester}º Bimestre`;
      const { error } = await supabase.from('submissions').insert({
        student_id: student.id,
        student_name: student.name.trim(),
        school_class: student.school_class.trim(),
        grade: student.grade,
        lesson_id: examId,
        lesson_title: examTitle.trim(),
        subject: exam.subject,
        score: finalScore,
        content: correctionDetails.map(c => ({
          question: c.question,
          answer: c.studentAnswer,
          correctAnswer: c.correctAnswer,
        })),
        ai_feedback: {
          generalComment,
          corrections: correctionDetails,
          integrity: integrityData,
        },
        teacher_feedback: null,
        submitted_at: nowIso,
        submission_date: nowIso,
        status: 'completed',
      });
      if (error) throw error;

      setIsFinished(true);
    } catch (err: any) {
      console.error('Erro ao salvar avaliação:', err);
      alert('Falha ao salvar: ' + (err?.message || 'tente novamente.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (checkingStatus) return (
    <div className="h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 gap-4 transition-colors duration-300">
      <Loader2 className="animate-spin text-tocantins-blue dark:text-tocantins-yellow" size={40} />
      <p className="text-slate-400 dark:text-slate-500 font-bold uppercase text-[10px] tracking-widest">Validando sua tentativa...</p>
    </div>
  );

  if (!exam) return null;

  const subjectInfo = subjectsInfo[exam.subject as Subject];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans pb-32 transition-colors duration-300">
      <div className={`${subjectInfo.color} text-white py-12 px-4 shadow-lg border-b border-white/5`}>
        <div className="container mx-auto max-w-3xl">
           <button onClick={() => navigate('/')} className="flex items-center gap-2 text-white/80 hover:text-white mb-6 text-sm font-bold transition-all">
             <ArrowLeft size={16}/> Voltar ao Início
           </button>
           <div className="flex items-center gap-6">
              <div className="w-20 h-20 bg-white/20 rounded-[30px] flex items-center justify-center text-4xl shadow-inner border border-white/20">
                 {subjectInfo.icon}
              </div>
              <div>
                 <h1 className="text-3xl font-black uppercase tracking-tighter">Avaliação: {subjectInfo.name}</h1>
                 <p className="text-white/70 font-bold uppercase tracking-widest text-[10px]">{exam.bimester}º Bimestre • {student.grade}ª Série</p>
              </div>
           </div>
        </div>
      </div>

      <div className="container mx-auto max-w-3xl px-4 -mt-8">
        {!isFinished && isEssay ? (
          /* ============== REDAÇÃO ============== */
          <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
            {/* Aviso de regras de segurança */}
            <div className="bg-gradient-fire p-1 rounded-3xl shadow-glow-orange">
              <div className="bg-white dark:bg-slate-900 p-6 rounded-[20px]">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 bg-gradient-fire rounded-2xl flex items-center justify-center text-white shadow-glow-orange shrink-0">
                    <ShieldAlert size={22}/>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-black text-slate-800 dark:text-white text-base tracking-tight">⚠️ Modo Redação · Atenção</h3>
                    <ul className="text-xs text-slate-600 dark:text-slate-400 font-medium mt-2 space-y-1 leading-relaxed">
                      <li>• <strong>Não é permitido colar texto</strong> de fora (a área bloqueia automaticamente).</li>
                      <li>• Cada vez que você sair desta janela / mudar de aba, fica registrado e o professor é avisado.</li>
                      <li>• Você tem <strong>uma única tentativa</strong>. Escreva com calma.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Card principal da redação */}
            <div className="bg-white dark:bg-slate-900 rounded-[40px] shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden">
              <div className="p-6 border-b dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
                <p className="text-[10px] font-black text-vibe-orange uppercase tracking-[0.3em] mb-1">✍️ Tema da Redação</p>
                <h2 className="text-2xl md:text-3xl font-black text-slate-800 dark:text-white tracking-tight leading-tight font-display">
                  {exam.title || exam.questions?.[0]?.questionText || 'Redação'}
                </h2>
                {exam.questions?.[0]?.instructions && (
                  <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/10 rounded-2xl border border-blue-100 dark:border-blue-900/30">
                    <p className="text-xs font-bold text-blue-900 dark:text-blue-200 leading-relaxed whitespace-pre-wrap">{exam.questions[0].instructions}</p>
                  </div>
                )}
              </div>

              <div className="p-6">
                {/* Métricas em tempo real */}
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3 px-2">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                      {String(answers[1] || '').length} caracteres · {String(answers[1] || '').split(/\s+/).filter(Boolean).length} palavras
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {tabSwitches > 0 && (
                      <span className="inline-flex items-center gap-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest">
                        <AlertTriangle size={11}/> {tabSwitches} saída{tabSwitches > 1 ? 's' : ''} de tela
                      </span>
                    )}
                    {pasteAttempts > 0 && (
                      <span className="inline-flex items-center gap-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest">
                        🚫 {pasteAttempts} tentativa{pasteAttempts > 1 ? 's' : ''} de colar
                      </span>
                    )}
                    <SuspicionBadge level={suspicionLevel} />
                  </div>
                </div>

                {/* Textarea com bloqueio de paste e tracking */}
                <textarea
                  ref={attachTextareaMonitor}
                  value={String(answers[1] || '')}
                  onChange={e => setAnswers(prev => ({ ...prev, 1: e.target.value }))}
                  onKeyDown={handleKeyDown}
                  onInput={handleInput}
                  onPaste={(e) => { handlePaste(e); alert('🚫 Não é permitido colar texto na redação. Digite o seu próprio texto.'); }}
                  onDrop={(e) => { e.preventDefault(); }}
                  onContextMenu={(e) => e.preventDefault()}
                  placeholder="Escreva aqui sua redação… (mínimo 200 caracteres)"
                  rows={30}
                  spellCheck={true}
                  autoCorrect="off"
                  autoComplete="off"
                  className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-2xl p-5 text-base text-slate-700 dark:text-slate-200 outline-none focus:border-vibe-orange focus:ring-4 focus:ring-orange-100 dark:focus:ring-orange-900/10 leading-loose font-serif"
                  style={{ minHeight: '650px' }}
                />
              </div>
            </div>

            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="w-full bg-gradient-fire text-white py-6 rounded-[32px] font-black uppercase tracking-[0.25em] text-sm shadow-glow-orange hover:scale-[1.02] transition-all active:scale-95 flex items-center justify-center gap-3 disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? <Loader2 className="animate-spin"/> : <Send size={20}/>}
              {isCorrectingEssay ? '🤖 IA corrigindo…' : isSubmitting ? 'Enviando…' : '✍️ Enviar Redação para Correção'}
            </button>
          </div>
        ) : !isFinished ? (
           <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
              <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl shadow-xl border-2 border-indigo-100 dark:border-indigo-900 transition-colors duration-300">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Info className="text-indigo-500 dark:text-indigo-400 shrink-0" size={20}/>
                    <p className="text-xs font-bold text-slate-600 dark:text-slate-400">Você tem <strong>uma tentativa</strong>. <strong>Não saia desta tela</strong> — saídas e colagens ficam registradas e podem anular sua prova.</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 px-3 py-2 rounded-2xl font-black text-slate-400 dark:text-slate-500 text-xs">
                      <Clock size={13}/> {Object.keys(answers).length}/{(shuffledExam || exam).questions.length}
                    </div>
                    <div className={`flex items-center gap-1.5 px-3 py-2 rounded-2xl font-black text-sm tabular-nums ${timeLeft <= 60 ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 animate-pulse' : timeLeft <= 300 ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400' : timeLeft <= 600 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' : 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'}`}>
                      ⏱ {formatTime(timeLeft)}
                    </div>
                  </div>
                </div>
              </div>

              {(() => {
                const totalViolations = tabSwitches + pasteAttempts + programmaticInputs;
                const remaining = 10 - totalViolations;
                if (totalViolations >= 8) return (
                  <div className="bg-red-50 dark:bg-red-950/40 border-2 border-red-500 rounded-3xl p-5 -mt-4 animate-pulse">
                    <p className="font-black text-red-700 dark:text-red-300 text-sm">🔴 AVISO FINAL: {totalViolations}/10 infrações. Mais {remaining} infração{remaining !== 1 ? 'ões' : ''} e sua prova será <strong>ANULADA com nota ZERO</strong>.</p>
                  </div>
                );
                if (totalViolations >= 5) return (
                  <div className="bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-400 rounded-3xl p-5 -mt-4">
                    <p className="font-black text-amber-700 dark:text-amber-300 text-sm">⚠️ ATENÇÃO: {totalViolations}/10 infrações detectadas. Com 10 infrações a prova é anulada com nota ZERO. Restam {remaining}.</p>
                  </div>
                );
                if (totalViolations > 0) return (
                  <div className="flex flex-wrap items-center gap-2 -mt-4 px-2">
                    {tabSwitches > 0 && (
                      <span className="inline-flex items-center gap-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest">
                        <AlertTriangle size={12}/> {tabSwitches} saída{tabSwitches > 1 ? 's' : ''} de tela
                      </span>
                    )}
                    {pasteAttempts > 0 && (
                      <span className="inline-flex items-center gap-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest">
                        🚫 {pasteAttempts} tentativa{pasteAttempts > 1 ? 's' : ''} de colar
                      </span>
                    )}
                    <SuspicionBadge level={suspicionLevel} />
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">({totalViolations}/10 infrações)</span>
                  </div>
                );
                return null;
              })()}

              {exam.visualContent && (
                 <div className="bg-white dark:bg-slate-900 rounded-[40px] shadow-xl border border-slate-100 dark:border-slate-800 p-8 mb-8 transition-colors duration-300">
                    <VisualActivityRenderer content={exam.visualContent} />
                 </div>
              )}

              {(shuffledExam || exam).questions && Array.isArray((shuffledExam || exam).questions) && (shuffledExam || exam).questions.map((q: any, idx: number) => {
                const isDiscursive = q.type === 'discursive' || !q.options || !q.correctOption;
                return (
                 <div key={idx} className="bg-white dark:bg-slate-900 rounded-[40px] shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden transition-colors duration-300">
                    <div className="p-8 border-b dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 flex items-center justify-between">
                       <span className="bg-slate-900 dark:bg-slate-950 text-white w-10 h-10 rounded-xl flex items-center justify-center font-black">
                          {idx + 1}
                       </span>
                       <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-lg ${isDiscursive ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'}`}>
                         {isDiscursive ? 'Discursiva' : 'Objetiva (A–E)'}
                       </span>
                    </div>
                    <div className="p-8 space-y-6">
                       {q.textFragment && q.textFragment.trim() && (
                         <div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-3xl border-l-4 border-indigo-400 italic text-sm text-slate-600 dark:text-slate-400 leading-relaxed shadow-inner">
                            "{q.textFragment}"
                         </div>
                       )}
                       <p className="text-lg font-bold text-slate-800 dark:text-slate-100 leading-tight">{q.questionText}</p>

                       {!isDiscursive ? (
                         <div className="space-y-3">
                            {['a', 'b', 'c', 'd', 'e'].map(key => q.options[key as keyof typeof q.options] && (
                               <button
                                 key={key}
                                 onClick={() => handleOptionSelect(q.id, key)}
                                 className={`w-full text-left p-5 rounded-2xl border-2 transition-all flex items-start gap-4 ${answers[q.id] === key ? 'border-tocantins-blue dark:border-tocantins-yellow bg-blue-50 dark:bg-blue-900/20 shadow-md ring-2 ring-blue-100 dark:ring-blue-900/40' : 'border-slate-50 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 hover:border-slate-200 dark:hover:border-slate-600'}`}
                               >
                                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 font-black uppercase text-xs ${answers[q.id] === key ? 'bg-tocantins-blue dark:bg-tocantins-yellow text-white dark:text-slate-950' : 'bg-white dark:bg-slate-900 text-slate-400 dark:text-slate-500 border dark:border-slate-700'}`}>
                                     {key}
                                  </span>
                                  <span className={`text-sm leading-relaxed ${answers[q.id] === key ? 'text-blue-900 dark:text-blue-100 font-bold' : 'text-slate-600 dark:text-slate-400 font-medium'}`}>
                                     {q.options[key as keyof typeof q.options] as string}
                                  </span>
                               </button>
                            ))}
                         </div>
                       ) : (
                         <div>
                           <textarea
                             ref={attachTextareaMonitor}
                             value={String(answers[q.id] || '')}
                             onChange={e => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                             onKeyDown={handleKeyDown}
                             onInput={handleInput}
                             onPaste={(e) => { handlePaste(e); alert('🚫 Não é permitido colar texto. Digite a sua própria resposta.'); }}
                             onDrop={(e) => e.preventDefault()}
                             onContextMenu={(e) => e.preventDefault()}
                             placeholder="Digite sua resposta argumentativa aqui (mínimo 30 caracteres)..."
                             rows={6}
                             className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-2xl p-5 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-tocantins-blue dark:focus:border-tocantins-yellow focus:ring-4 focus:ring-blue-100 dark:focus:ring-blue-900/10 leading-relaxed"
                           />
                           <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-2 ml-2">
                             {String(answers[q.id] || '').length} caracteres • Avaliada por IA + revisão do professor
                           </p>
                         </div>
                       )}
                    </div>
                 </div>
               );
              })}

              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="w-full bg-gradient-cosmic text-white py-6 rounded-[32px] font-black uppercase tracking-[0.25em] text-sm shadow-glow-purple hover:shadow-glow-pink hover:scale-[1.02] transition-all active:scale-95 flex items-center justify-center gap-3 disabled:opacity-50 cursor-pointer"
              >
                 {isSubmitting ? <Loader2 className="animate-spin"/> : <Send size={20}/>}
                 🚀 Finalizar e Bloquear Tentativa
              </button>
           </div>
        ) : isAnnulled ? (
          <div className="bg-red-600 p-1 rounded-[44px] shadow-2xl animate-in zoom-in duration-500">
            <div className="bg-white dark:bg-slate-900 rounded-[40px] p-10 text-center">
              <div className="w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6 bg-red-600 text-white shadow-2xl">
                <ShieldAlert size={44}/>
              </div>
              <h2 className="text-4xl font-black tracking-tighter mb-3 text-red-600 dark:text-red-400">🚫 Prova Anulada</h2>
              <p className="text-slate-500 dark:text-slate-400 font-bold text-sm mb-5 max-w-sm mx-auto leading-relaxed">
                Sua prova foi <strong>ANULADA</strong> por excesso de infrações (tentativas de cola + saídas de tela). Nota registrada: <strong>0,0</strong>.
              </p>
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-2xl p-4 mb-6 text-left max-w-xs mx-auto">
                <p className="text-[10px] font-black text-red-700 dark:text-red-300 uppercase tracking-widest mb-2">Infrações registradas</p>
                <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                  <li>• Saídas de tela: <strong>{tabSwitches}</strong></li>
                  <li>• Tentativas de colar: <strong>{pasteAttempts}</strong></li>
                  {programmaticInputs > 0 && <li>• Inserções automáticas: <strong>{programmaticInputs}</strong></li>}
                  <li className="pt-1 font-black text-red-600 dark:text-red-400">Total: {tabSwitches + pasteAttempts + programmaticInputs}/10</li>
                </ul>
              </div>
              <button onClick={() => navigate('/')} className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 py-4 px-8 rounded-2xl font-black uppercase text-[10px] tracking-[0.25em] hover:scale-105 transition-all">🏠 Voltar ao Início</button>
            </div>
          </div>
        ) : (
           <div className={`relative overflow-hidden ${alreadyDone ? 'bg-gradient-aurora' : 'bg-gradient-fire'} p-1 rounded-[44px] ${alreadyDone ? 'shadow-glow-cyan' : 'shadow-glow-orange'} animate-in zoom-in duration-500`}>
            {/* confete-style blobs decorativos */}
            {!alreadyDone && (
              <>
                <div className="absolute top-10 left-10 w-32 h-32 bg-vibe-lime/40 rounded-full blur-2xl animate-blob"></div>
                <div className="absolute top-1/3 right-10 w-32 h-32 bg-vibe-pink/40 rounded-full blur-2xl animate-blob" style={{ animationDelay: '2s' }}></div>
                <div className="absolute bottom-10 left-1/3 w-32 h-32 bg-vibe-cyan/40 rounded-full blur-2xl animate-blob" style={{ animationDelay: '4s' }}></div>
              </>
            )}
            <div className="relative bg-white dark:bg-slate-900 rounded-[40px] p-12 text-center">
              <div className={`w-28 h-28 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl animate-float ${alreadyDone ? 'bg-gradient-aurora text-white shadow-glow-cyan' : isEssay ? 'bg-gradient-fire text-white shadow-glow-orange' : 'bg-gradient-fire text-white shadow-glow-orange'}`}>
                 {alreadyDone ? <Lock size={48}/> : isEssay ? <Pencil size={48} strokeWidth={2.5}/> : <CheckCircle2 size={56} strokeWidth={2.5}/>}
              </div>
              <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-3 font-display">
                <span className={alreadyDone ? 'text-gradient-aurora' : 'text-gradient-sunset'}>
                  {alreadyDone
                    ? (isEssay ? '🔒 Redação já Enviada' : '🔒 Prova já Realizada')
                    : (isEssay
                        ? (essayCorrection ? '🎯 Sua Nota ENEM' : '✍️ Redação Enviada!')
                        : '🎉 Mandou bem!')}
                </span>
              </h2>
              <p className="text-slate-500 dark:text-slate-400 font-bold text-sm tracking-wide mb-2 max-w-md mx-auto">
                {alreadyDone
                  ? 'Você já usou sua única chance.'
                  : isEssay
                    ? (essayCorrection
                        ? 'A IA corrigiu pelas 5 competências do ENEM. O professor revisa e dá a nota final.'
                        : 'Sua redação foi enviada. O professor vai avaliar em breve.')
                    : 'Sua resposta foi enviada e a IA já corrigiu!'}
              </p>
              {!alreadyDone && !isEssay && score > 0 && (
                <div className="inline-flex items-center gap-3 bg-gradient-fire text-white px-8 py-4 rounded-full shadow-glow-orange mt-4 mb-8 animate-pulse-glow">
                  <Award size={24}/>
                  <span className="text-3xl font-black tracking-tighter">{score.toFixed(1)}</span>
                  <span className="text-[10px] font-black uppercase tracking-widest opacity-90">/ 10</span>
                </div>
              )}

              {/* === Correção ENEM da Redação === */}
              {!alreadyDone && isEssay && essayCorrection && (
                <div className="mt-6 mb-2 text-left">
                  {/* Nota final destacada */}
                  <div className="flex flex-col items-center mb-6">
                    <div className="inline-flex items-center gap-3 bg-gradient-fire text-white px-8 py-4 rounded-full shadow-glow-orange animate-pulse-glow">
                      <Award size={26}/>
                      <span className="text-4xl font-black tracking-tighter">{essayCorrection.totalScore}</span>
                      <span className="text-[10px] font-black uppercase tracking-widest opacity-90">/ 1000</span>
                    </div>
                    <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400 mt-3">
                      Nota equivalente · <span className="text-vibe-orange">{essayCorrection.score0to10.toFixed(1)} / 10</span>
                    </p>
                  </div>

                  {/* 5 competências */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 mb-6">
                    {(['c1','c2','c3','c4','c5'] as const).map((k, i) => {
                      const c = essayCorrection[k];
                      const pct = (c.score / 200) * 100;
                      const labels = ['Norma culta','Tema','Argumentação','Coesão','Intervenção'];
                      return (
                        <div key={k} className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-3 border border-slate-100 dark:border-slate-800">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[9px] font-black text-vibe-orange uppercase tracking-widest">C{i+1}</span>
                            <span className="text-sm font-black text-slate-800 dark:text-slate-100">{c.score}<span className="text-[9px] text-slate-400">/200</span></span>
                          </div>
                          <p className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">{labels[i]}</p>
                          <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-fire" style={{ width: `${pct}%` }}></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Comentário geral */}
                  {essayCorrection.generalComment && (
                    <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-2xl p-4 mb-4">
                      <p className="text-[9px] font-black text-blue-700 dark:text-blue-300 uppercase tracking-widest mb-1">🤖 Comentário Geral</p>
                      <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{essayCorrection.generalComment}</p>
                    </div>
                  )}

                  {/* Feedback por competência (expansível) */}
                  <details className="text-sm group mb-4">
                    <summary className="cursor-pointer font-black text-vibe-purple uppercase text-[10px] tracking-[0.25em] hover:underline list-none">
                      📋 Ver comentário detalhado das 5 competências
                    </summary>
                    <div className="mt-3 space-y-2">
                      {(['c1','c2','c3','c4','c5'] as const).map((k, i) => {
                        const c = essayCorrection[k];
                        const labels = ['Domínio da Norma Culta','Compreensão do Tema','Argumentação','Coesão e Coerência','Proposta de Intervenção'];
                        return (
                          <div key={k} className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700">
                            <p className="text-[10px] font-black text-vibe-orange uppercase tracking-widest">C{i+1} · {labels[i]} · {c.score}/200</p>
                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mt-1">{c.feedback}</p>
                          </div>
                        );
                      })}
                    </div>
                  </details>

                  {/* Pontos fortes / fracos / dicas */}
                  {(essayCorrection.strengths?.length || essayCorrection.weaknesses?.length || essayCorrection.improvementTips?.length) && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                      {essayCorrection.strengths?.length > 0 && (
                        <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30 rounded-xl p-3">
                          <p className="text-[9px] font-black text-emerald-700 dark:text-emerald-300 uppercase tracking-widest mb-2">✨ Pontos Fortes</p>
                          <ul className="space-y-1.5">
                            {essayCorrection.strengths.map((s: string, idx: number) => (
                              <li key={idx} className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">• {s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {essayCorrection.weaknesses?.length > 0 && (
                        <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 rounded-xl p-3">
                          <p className="text-[9px] font-black text-amber-700 dark:text-amber-300 uppercase tracking-widest mb-2">⚠️ Pontos a Melhorar</p>
                          <ul className="space-y-1.5">
                            {essayCorrection.weaknesses.map((s: string, idx: number) => (
                              <li key={idx} className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">• {s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {essayCorrection.improvementTips?.length > 0 && (
                        <div className="bg-purple-50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-900/30 rounded-xl p-3">
                          <p className="text-[9px] font-black text-purple-700 dark:text-purple-300 uppercase tracking-widest mb-2">💡 Dicas Práticas</p>
                          <ul className="space-y-1.5">
                            {essayCorrection.improvementTips.map((s: string, idx: number) => (
                              <li key={idx} className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">• {s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!alreadyDone && isEssay && tabSwitches > 0 && (
                <div className="inline-flex items-center gap-2 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-5 py-2.5 rounded-full mt-2 mb-4 text-xs font-black uppercase tracking-widest">
                  <AlertTriangle size={14}/> Você saiu da tela {tabSwitches} {tabSwitches === 1 ? 'vez' : 'vezes'}
                </div>
              )}
              {alreadyDone && (
                <p className="text-slate-400 dark:text-slate-500 font-black uppercase text-[10px] tracking-[0.3em] mb-8">{isEssay ? 'Aguardando avaliação do professor' : 'Sua nota já está no histórico'}</p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-md mx-auto">
                 <button onClick={() => navigate('/')} className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 py-4 rounded-2xl font-black uppercase text-[10px] tracking-[0.25em] hover:scale-105 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all">🏠 Início</button>
                 <Link to="/my-activities" className="bg-gradient-vibe text-white py-4 rounded-2xl font-black uppercase text-[10px] tracking-[0.25em] shadow-glow-purple hover:scale-105 hover:shadow-glow-pink transition-all">📚 Ver Histórico</Link>
              </div>
            </div>
           </div>
        )}
      </div>
    </div>
  );
};
