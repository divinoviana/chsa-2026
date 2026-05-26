
import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { curriculumData, subjectsInfo } from '../data';
import { ActivityInput } from '../components/ActivityInput';
import { SubmissionBar, SubmissionItem } from '../components/SubmissionBar';
import { ArrowLeft, BookOpen, PenTool, Sparkles, Home, Loader2, ListChecks, HelpCircle, CheckCircle2 } from 'lucide-react';
import { evaluateActivities, AIResponse, LessonActivity } from '../services/aiService';
import { AIFeedbackModal } from '../components/AIFeedbackModal';
import { useAuth } from '../context/AuthContext';
import { VisualActivityRenderer } from '../components/VisualActivityRenderer';
import { exportToPDF } from '../lib/pdfUtils';
import { supabase } from '../lib/supabase';
import { Download } from 'lucide-react';
import { useIntegrityMonitor, SuspicionBadge } from '../lib/useIntegrityMonitor';

export const LessonView: React.FC = () => {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const { student, isLoading } = useAuth();

  const [lessonActivity, setLessonActivity] = useState<LessonActivity | null>(null);
  const [lessonOverride, setLessonOverride] = useState<any>(null);
  const [isActivityLoading, setIsActivityLoading] = useState(false);
  const [activityExpiresAt, setActivityExpiresAt] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiData, setAiData] = useState<AIResponse | null>(null);

  const {
    suspicionLevel, handleKeyDown, handlePaste, handleInput, attachTextareaMonitor, getIntegrityData,
  } = useIntegrityMonitor(!!student && !!lessonId);

  useEffect(() => {
    if (!isLoading && !student) {
      navigate('/login');
    }
  }, [student, isLoading, navigate]);

  useEffect(() => {
    setAnswers({});
    setAiData(null);
    setIsAIModalOpen(false);
    setLessonActivity(null);
  }, [lessonId]);

  // Busca a lição e gera atividade via banco de dados
  useEffect(() => {
    const fetchActivity = async () => {
      if (!foundLesson) return;
      setIsActivityLoading(true);
      try {
        // 0. Override da aula
        const { data: overrideData } = await supabase
          .from('lesson_overrides')
          .select('data')
          .eq('id', lessonId!)
          .maybeSingle();
        if (overrideData?.data) {
          setLessonOverride(overrideData.data);
        }

        // 1. Atividade ligada à aula
        const { data: actRows } = await supabase
          .from('activities')
          .select('*')
          .eq('lesson_id', lessonId!)
          .limit(1);

        if (!actRows || actRows.length === 0) {
          setLessonActivity(null);
          return;
        }
        const actData = actRows[0] as any;

        if (actData.expires_at) setActivityExpiresAt(actData.expires_at);

        // 2. Questões da atividade
        // Suporta dois modelos: questions.lesson_id (legado) ou activities.question_ids (jsonb)
        let qRows: any[] = [];
        const byLessonRes: any = await supabase
          .from('questions')
          .select('*')
          .eq('lesson_id', lessonId!);
        if (byLessonRes.data && byLessonRes.data.length > 0) {
          qRows = byLessonRes.data;
        } else if (Array.isArray(actData.question_ids) && actData.question_ids.length > 0) {
          const byIdsRes: any = await supabase
            .from('questions')
            .select('*')
            .in('id', actData.question_ids);
          qRows = byIdsRes.data || [];
        }

        if (qRows.length === 0) {
          setLessonActivity(null);
          return;
        }

        const objectives: any[] = [];
        const discursives: any[] = [];
        qRows.forEach((q: any) => {
          if (q.type === 'objective') {
            objectives.push({
              id: q.id,
              question: q.question_text,
              options: q.options,
              correctOption: q.correct_option,
            });
          } else if (q.type === 'discursive') {
            discursives.push({ id: q.id, question: q.question_text });
          }
        });

        setLessonActivity({
          objectives,
          discursives,
          visualContent: actData.visual_content,
          dbActivityId: actData.id,
        } as any);
      } catch (e) {
        console.error('Erro ao buscar atividade:', e);
      } finally {
        setIsActivityLoading(false);
      }
    };
    if (lessonId) fetchActivity();
  }, [lessonId]);

  const getTodayString = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  let foundLesson = null;
  let parentGradeId = 1;
  for (const g of curriculumData) {
    for (const b of g.bimesters) {
      const l = b.lessons.find(l => l.id === lessonId);
      if (l) {
        foundLesson = l;
        parentGradeId = g.id;
        break;
      }
    }
    if (foundLesson) break;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-tocantins-blue rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!foundLesson) return <div className="p-8 text-center">Aula não encontrada.</div>;

  const displayTitle = lessonOverride?.title || foundLesson.title;
  const displayTheory = lessonOverride?.theory || null;

  const handleOptionSelect = (questionId: string, option: string) => {
    setAnswers(prev => ({ ...prev, [`obj-${questionId}`]: option }));
  };

  const handleDiscursiveChange = (questionId: string, value: string) => {
    setAnswers(prev => ({ ...prev, [`disc-${questionId}`]: value }));
  };

  const getSubmissionData = (): SubmissionItem[] => {
    if (!lessonActivity) return [];
    const data: SubmissionItem[] = [];

    lessonActivity.objectives.forEach(q => {
      const ans = answers[`obj-${q.id}`];
      if (ans) {
        data.push({ 
          activityTitle: "Questões Objetivas", 
          question: q.question, 
          answer: `Opção ${ans.toUpperCase()}: ${q.options[ans as keyof typeof q.options]}`,
          correctAnswer: `Opção ${q.correctOption.toUpperCase()}: ${q.options[q.correctOption as keyof typeof q.options]}`
        });
      }
    });

    lessonActivity.discursives.forEach(q => {
      const ans = answers[`disc-${q.id}`];
      if (ans && ans.trim()) {
        data.push({ 
          activityTitle: "Questão Discursiva", 
          question: q.question, 
          answer: ans 
        });
      }
    });

    return data;
  };

  const handleLocalCorrection = async () => {
    const subData = getSubmissionData();
    if (subData.length === 0) {
      alert("Por favor, responda as atividades antes de finalizar.");
      return;
    }

    setAiLoading(true);
    setIsAIModalOpen(true);
    
    try {
      const qAndA = subData.map(s => ({ 
        question: s.question, 
        answer: s.answer,
        correctAnswer: s.correctAnswer 
      }));
      const evaluation = await evaluateActivities(displayTitle, displayTheory, qAndA);
      setAiData(evaluation);
    } catch (e: any) {
      console.error("AI Evaluation error:", e);
      // Fallback local correction
      const corrections: any[] = [];
      let totalScore = 0;
      
      lessonActivity?.objectives.forEach(q => {
        const ans = answers[`obj-${q.id}`];
        const isCorrect = ans === q.correctOption;
        if (isCorrect) totalScore += 10;
        
        corrections.push({
          question: q.question,
          studentAnswer: ans ? `Opção ${ans.toUpperCase()}: ${q.options[ans as keyof typeof q.options]}` : "Não respondida",
          isCorrect,
          score: isCorrect ? 10 : 0,
          feedback: isCorrect ? "Correto!" : `Incorreto. A resposta correta era a opção ${q.correctOption?.toUpperCase()}.`
        });
      });

      lessonActivity?.discursives.forEach(q => {
        const ans = answers[`disc-${q.id}`];
        corrections.push({
          question: q.question,
          studentAnswer: ans || "Não respondida",
          isCorrect: false,
          score: 0,
          feedback: "Questão discursiva salva para avaliação do professor."
        });
      });

      setAiData({
        generalComment: "Houve um erro na correção por IA, mas suas respostas foram enviadas. Suas questões objetivas foram corrigidas localmente.",
        corrections
      });
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-32 animate-in fade-in duration-500 transition-colors duration-300">
      <AIFeedbackModal isOpen={isAIModalOpen} isLoading={aiLoading} data={aiData} onClose={() => setIsAIModalOpen(false)} />
      
      <div className={`relative h-72 w-full overflow-hidden ${subjectsInfo[foundLesson.subject]?.gradient || subjectsInfo[foundLesson.subject]?.color || 'bg-slate-800'}`}>
        {/* Blobs decorativos */}
        <div className="absolute top-0 right-1/4 w-72 h-72 bg-white/20 rounded-full blur-3xl animate-blob"></div>
        <div className="absolute -bottom-20 left-1/4 w-72 h-72 bg-black/10 rounded-full blur-3xl animate-blob" style={{ animationDelay: '3s' }}></div>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-slate-50/30 dark:to-slate-950/40"></div>

        <div className="relative z-10 container mx-auto px-4 h-full flex flex-col justify-center max-w-4xl">
           <div className="flex gap-2 mb-4">
              <Link to="/" className="inline-flex items-center text-white/95 bg-black/30 hover:bg-black/50 hover:scale-105 px-4 py-2 rounded-full backdrop-blur-md transition-all border border-white/20 text-xs font-black tracking-widest uppercase">
                <Home className="w-3.5 h-3.5 mr-2" /> Início
              </Link>
              <Link to={`/grade/${parentGradeId}?subject=${foundLesson.subject}`} className="inline-flex items-center text-white/95 bg-white/15 hover:bg-white/25 hover:scale-105 px-4 py-2 rounded-full backdrop-blur-md transition-all border border-white/20 text-xs font-black tracking-widest uppercase">
                <ArrowLeft className="w-3.5 h-3.5 mr-2" /> Voltar
              </Link>
           </div>
          <div className="flex justify-between items-end gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.3em] text-white/70 mb-2">
                {subjectsInfo[foundLesson.subject]?.icon} {subjectsInfo[foundLesson.subject]?.name || foundLesson.subject}
              </p>
              <h1 className="text-3xl md:text-4xl font-black text-white tracking-tighter font-display drop-shadow-lg leading-tight">{displayTitle}</h1>
            </div>
            <button
              onClick={() => exportToPDF('lesson-printable-content', `Aula_${displayTitle}`)}
              className="shrink-0 mb-1 p-3 bg-white/15 hover:bg-white/30 hover:scale-110 rounded-2xl text-white backdrop-blur-md transition-all border border-white/20 shadow-lg"
              title="Baixar Aula em PDF"
            >
              <Download size={20}/>
            </button>
          </div>
          {student && (
            <div className="flex items-center gap-2 mt-4 text-white/95 bg-white/15 w-fit px-4 py-2 rounded-full backdrop-blur-md border border-white/20 shadow-md">
               <img src={student.photo_url} className="w-6 h-6 rounded-full object-cover ring-2 ring-vibe-lime/60" alt="User" />
               <span className="text-[10px] font-black uppercase tracking-widest">{student.name} · {student.school_class}</span>
            </div>
          )}
        </div>
      </div>

      <div className="container mx-auto px-4 max-w-4xl -mt-10 relative z-20" id="lesson-printable-content">
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-6 md:p-10 mb-8 transition-colors duration-300">
          
          {/* SEÇÃO: TEORIA */}
          <div className="prose prose-slate dark:prose-invert prose-lg max-w-none mb-12">
            <h3 className="flex items-center text-2xl font-bold text-slate-800 dark:text-slate-100 mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
              <BookOpen className="w-7 h-7 mr-3 text-indigo-600 dark:text-indigo-400" /> Teoria
            </h3>
            {displayTheory ? (
              <div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-2xl border-l-4 border-indigo-500 whitespace-pre-wrap text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
                {displayTheory}
              </div>
            ) : (
              <div className="bg-amber-50 dark:bg-amber-950/20 p-8 rounded-3xl border border-amber-200 dark:border-amber-800 text-center animate-in fade-in zoom-in-95">
                <HelpCircle className="mx-auto text-amber-500 mb-4" size={48} />
                <h4 className="text-amber-900 dark:text-amber-100 font-black uppercase text-sm tracking-tighter">Aula em Preparação</h4>
                <p className="text-amber-700 dark:text-amber-400 text-[10px] font-bold uppercase tracking-widest mt-2">O professor ainda não publicou o conteúdo teórico desta aula.</p>
              </div>
            )}
          </div>

          {/* SEÇÃO: ATIVIDADES */}
          <div className="mb-12">
            <h3 className="flex items-center text-2xl font-bold text-slate-800 dark:text-slate-100 mb-8 pb-4 border-b border-slate-100 dark:border-slate-800">
              <PenTool className="w-7 h-7 mr-3 text-tocantins-blue dark:text-tocantins-yellow" /> Atividades
            </h3>

            {isActivityLoading ? (
              <div className="bg-slate-50 dark:bg-slate-800 p-20 rounded-[40px] border border-dashed border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center gap-4 text-center">
                 <Loader2 className="animate-spin text-tocantins-blue dark:text-tocantins-yellow" size={32}/>
                 <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Buscando questões no banco...</p>
              </div>
            ) : activityExpiresAt && new Date(activityExpiresAt) < new Date() ? (
              <div className="relative overflow-hidden bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-800 dark:to-slate-700 p-1 rounded-[40px] animate-in fade-in">
                <div className="bg-white dark:bg-slate-900 p-12 rounded-[36px] text-center">
                  <div className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-5">
                    <CheckCircle2 className="text-slate-400" size={36} />
                  </div>
                  <h4 className="text-2xl font-black tracking-tighter font-display mb-2 text-slate-500">🔒 Prazo Encerrado</h4>
                  <p className="text-slate-500 dark:text-slate-400 text-xs font-bold tracking-wide">
                    O prazo para esta atividade foi encerrado em{' '}
                    {new Date(activityExpiresAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.
                  </p>
                </div>
              </div>
            ) : lessonActivity ? (
              <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                
                {/* RECURSO VISUAL DINÂMICO */}
                {lessonActivity.visualContent && (
                  <VisualActivityRenderer content={lessonActivity.visualContent} />
                )}

                {/* QUESTÕES OBJETIVAS */}
                {lessonActivity.objectives && lessonActivity.objectives.length > 0 && (
                  <div className="space-y-8">
                    <div className="flex items-center gap-2 mb-4">
                        <ListChecks className="text-tocantins-blue dark:text-tocantins-yellow" size={20}/>
                        <h4 className="font-black text-slate-400 uppercase text-[10px] tracking-widest">Parte 1: Questões Objetivas</h4>
                    </div>
                    {lessonActivity.objectives.map((q, idx) => (
                      <div key={q.id} className="bg-slate-50/50 dark:bg-slate-800/50 p-8 rounded-[32px] border border-slate-200 dark:border-slate-800 space-y-6">
                          <div className="flex items-start gap-4">
                             <span className="bg-slate-900 dark:bg-slate-950 text-white w-8 h-8 rounded-lg flex items-center justify-center font-black flex-shrink-0 text-sm">{idx + 1}</span>
                             <p className="text-lg font-bold text-slate-800 dark:text-slate-100 leading-tight">{q.question}</p>
                          </div>
                          <div className="space-y-3">
                             {['a', 'b', 'c', 'd', 'e'].map(opt => q.options[opt as keyof typeof q.options] && (
                               <button 
                                 key={opt}
                                 onClick={() => handleOptionSelect(q.id!, opt)}
                                 className={`w-full text-left p-4 rounded-2xl border-2 transition-all flex items-start gap-4 ${answers[`obj-${q.id}`] === opt ? 'border-tocantins-blue dark:border-tocantins-yellow bg-blue-50 dark:bg-blue-900/20 shadow-md ring-2 ring-blue-100 dark:ring-blue-900/40' : 'border-white dark:border-slate-800 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-100 dark:hover:border-slate-600'}`}
                               >
                                  <span className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 font-black uppercase text-[10px] ${answers[`obj-${q.id}`] === opt ? 'bg-tocantins-blue dark:bg-tocantins-yellow text-white dark:text-slate-950' : 'bg-slate-100 dark:bg-slate-900 text-slate-400'}`}>
                                     {opt}
                                  </span>
                                  <span className={`text-sm font-medium ${answers[`obj-${q.id}`] === opt ? 'text-blue-900 dark:text-blue-100' : 'text-slate-600 dark:text-slate-400'}`}>
                                     {q.options[opt as keyof typeof q.options] as string}
                                  </span>
                               </button>
                             ))}
                          </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* QUESTÕES DISCURSIVAS */}
                {lessonActivity.discursives && lessonActivity.discursives.length > 0 && (
                  <div className="space-y-8">
                    <div className="flex items-center gap-2 mb-4 flex-wrap">
                        <HelpCircle className="text-amber-500" size={20}/>
                        <h4 className="font-black text-slate-400 uppercase text-[10px] tracking-widest">Parte 2: Questões Discursivas</h4>
                        <SuspicionBadge level={suspicionLevel} />
                    </div>
                    {lessonActivity.discursives.map((q, idx) => (
                      <div key={q.id} className="bg-white dark:bg-slate-900 p-8 rounded-[32px] border border-slate-200 dark:border-slate-800 shadow-sm">
                          <ActivityInput
                            questionId={q.id!}
                            questionText={`${(lessonActivity.objectives?.length || 0) + idx + 1}. ${q.question}`}
                            value={answers[`disc-${q.id}`] || ''}
                            onChange={(val) => handleDiscursiveChange(q.id!, val)}
                            onKeyDown={handleKeyDown}
                            onInput={handleInput}
                            onPasteBlocked={handlePaste}
                            textareaRef={attachTextareaMonitor}
                          />
                      </div>
                    ))}
                  </div>
                )}

                  <div className="relative overflow-hidden bg-gradient-vibe p-1 rounded-[32px] shadow-glow-purple animate-in fade-in zoom-in-95">
                    <div className="bg-white dark:bg-slate-900 p-8 rounded-[28px] text-center">
                      <Sparkles className="mx-auto text-vibe-pink mb-4 animate-pulse-glow" size={36} />
                      <h4 className="text-2xl font-black tracking-tighter font-display mb-2">
                        <span className="text-gradient-vibe">✨ Tudo certo?</span>
                      </h4>
                      <p className="text-slate-600 dark:text-slate-400 text-[11px] font-bold uppercase tracking-widest mt-2 px-4">
                        Mande agora pro seu professor. A IA corrige e ele dá o feedback final 💜
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
              <div className="relative overflow-hidden bg-gradient-aurora p-1 rounded-[40px] shadow-glow-cyan animate-in fade-in">
                <div className="bg-white dark:bg-slate-900 p-12 rounded-[36px] text-center">
                  <div className="w-20 h-20 bg-gradient-aurora rounded-full flex items-center justify-center mx-auto mb-5 shadow-glow-cyan animate-float">
                    <ListChecks className="text-white" size={36} />
                  </div>
                  <h4 className="text-2xl font-black tracking-tighter font-display mb-2">
                    <span className="text-gradient-aurora">🎯 Prepare-se…</span>
                  </h4>
                  <p className="text-slate-500 dark:text-slate-400 text-xs font-bold tracking-wide">
                    O professor ainda está montando as atividades. Volte logo!
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {student && !(activityExpiresAt && new Date(activityExpiresAt) < new Date()) && (
        <SubmissionBar
          studentName={student.name}
          schoolClass={student.school_class}
          submissionDate={getTodayString()}
          lessonId={lessonId!}
          lessonTitle={displayTitle}
          subject={foundLesson.subject}
          submissionData={getSubmissionData()}
          aiData={aiData}
          theory={displayTheory || ''}
          integrityData={getIntegrityData()}
        />
      )}
    </div>
  );
};
