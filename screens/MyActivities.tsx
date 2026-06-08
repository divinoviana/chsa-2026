
import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { curriculumData } from '../data';
import { ArrowLeft, BookCheck, Star, MessageSquare, RotateCcw, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const MyActivities: React.FC = () => {
  const navigate = useNavigate();
  const { student, isLoading: isAuthLoading } = useAuth();
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthLoading) {
      if (!student) {
        navigate('/login');
      } else {
        fetchMySubmissions(student.id);
      }
    }
  }, [student, isAuthLoading, navigate]);

  const fetchMySubmissions = async (studentId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('submissions')
        .select('*')
        .eq('student_id', studentId)
        .order('submitted_at', { ascending: false, nullsFirst: false });
      if (error) throw error;
      setSubmissions(data || []);
    } catch (err: any) {
      console.error('Erro ao buscar histórico:', err);
      setSubmissions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleRedo = (lessonTitle: string) => {
    // Busca o ID da aula no curriculumData baseado no título
    let lessonIdFound = "";
    
    curriculumData.forEach(grade => {
      grade.bimesters.forEach(bimester => {
        const lesson = bimester.lessons.find(l => l.title === lessonTitle);
        if (lesson) lessonIdFound = lesson.id;
      });
    });

    if (lessonIdFound) {
      if (confirm(`Deseja refazer a aula: "${lessonTitle}"?`)) {
        navigate(`/lesson/${lessonIdFound}`);
      }
    } else {
      alert("Aula original não encontrada. Tente acessar pela página inicial.");
    }
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
        <div className="w-10 h-10 border-4 border-slate-200 dark:border-slate-800 border-t-tocantins-blue dark:border-t-tocantins-yellow rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!student) return null;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans pb-20 transition-colors duration-300 relative overflow-hidden">
      <div className="absolute inset-0 bg-mesh-bg opacity-50 dark:opacity-15 pointer-events-none"></div>

      <div className="relative bg-gradient-cosmic text-white p-8 md:p-14 overflow-hidden">
        <div className="absolute top-0 right-1/4 w-72 h-72 bg-vibe-cyan/30 rounded-full blur-3xl animate-blob"></div>
        <div className="absolute -bottom-20 left-1/3 w-72 h-72 bg-vibe-pink/30 rounded-full blur-3xl animate-blob" style={{ animationDelay: '3s' }}></div>
        <div className="container mx-auto max-w-4xl relative z-10">
          <Link to="/" className="inline-flex items-center text-white/90 hover:text-white mb-6 transition-all font-black text-[10px] uppercase tracking-[0.3em] bg-white/10 hover:bg-white/20 hover:scale-105 px-4 py-2 rounded-full backdrop-blur-md">
            <ArrowLeft size={14} className="mr-2"/> Voltar
          </Link>
          <h1 className="text-4xl md:text-5xl font-black tracking-tighter font-display flex items-center gap-3 drop-shadow-lg">
            <BookCheck className="text-vibe-lime drop-shadow-[0_0_20px_rgba(163,230,53,0.8)]" size={42}/>
            Meu Histórico 📚
          </h1>
          <p className="text-white/80 mt-3 font-medium text-sm">{student.name} · <span className="text-vibe-lime font-black">{student.school_class}</span></p>
        </div>
      </div>

      <div className="container mx-auto max-w-4xl px-4 -mt-10 relative z-10">
        {loading ? (
          <div className="bg-white dark:bg-slate-900 p-20 rounded-[40px] shadow-xl border border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center gap-4 transition-colors">
             <Loader2 className="animate-spin text-vibe-purple" size={40}/>
             <p className="text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest text-[10px]">Buscando seus registros…</p>
          </div>
        ) : submissions.length === 0 ? (
          <div className="relative overflow-hidden bg-gradient-aurora p-1 rounded-[40px] shadow-glow-cyan">
            <div className="bg-white dark:bg-slate-900 p-14 rounded-[36px] text-center">
              <div className="w-20 h-20 bg-gradient-aurora rounded-full flex items-center justify-center mx-auto mb-5 shadow-glow-cyan animate-float">
                <BookCheck className="text-white" size={36}/>
              </div>
              <h3 className="text-2xl font-black tracking-tighter font-display mb-2">
                <span className="text-gradient-aurora">📭 Tudo zerado por aqui</span>
              </h3>
              <p className="text-slate-500 dark:text-slate-400 text-xs font-bold tracking-wide mb-6">Você ainda não enviou nenhuma atividade.</p>
              <Link to="/" className="inline-block bg-gradient-vibe text-white px-8 py-3.5 rounded-2xl font-black uppercase text-[10px] tracking-[0.25em] shadow-glow-purple hover:scale-105 hover:shadow-glow-pink transition-all">
                🚀 Começar agora
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {submissions.map(sub => {
              const score = Number(sub.score) || 0;
              const isManualGrade = sub.status === 'manual_grade';
              const isExam = String(sub.lesson_title || '').toLowerCase().includes('avaliação bimestral') || String(sub.lesson_title || '').toLowerCase().includes('simulado');
              const scoreClass = score >= 7 ? 'bg-gradient-fire text-white shadow-glow-orange' : score >= 5 ? 'bg-gradient-aurora text-white shadow-glow-cyan' : 'bg-gradient-sunset text-white shadow-glow-pink';
              return (
              <div key={sub.id} className={`relative overflow-hidden ${isManualGrade ? 'bg-gradient-cosmic' : isExam ? 'bg-gradient-fire' : 'bg-gradient-vibe'} p-1 rounded-[32px] shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1`}>
                <div className="bg-white dark:bg-slate-900 rounded-[28px] overflow-hidden">
                  <div className="p-6 border-b dark:border-slate-800 flex justify-between items-start gap-4 bg-slate-50/40 dark:bg-slate-800/20">
                    <div className="flex-1 min-w-0">
                      {(() => {
                        if (isManualGrade) return <span className="inline-block bg-gradient-cosmic text-white px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest mb-2">📝 Nota do Professor</span>;
                        const isEssayItem = sub.ai_feedback?.type === 'essay_enem' || String(sub.lesson_title || '').startsWith('Redação:');
                        if (isEssayItem) return <span className="inline-block bg-gradient-fire text-white px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest mb-2">✍️ Redação ENEM</span>;
                        if (isExam) return <span className="inline-block bg-gradient-fire text-white px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest mb-2">🎯 Simulado</span>;
                        return null;
                      })()}
                      <h3 className="font-black text-slate-800 dark:text-slate-100 text-lg leading-tight">{sub.lesson_title}</h3>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black tracking-widest mt-2">Enviado em {sub.submitted_at ? new Date(sub.submitted_at).toLocaleString('pt-BR') : (sub.submission_date ? new Date(sub.submission_date).toLocaleString('pt-BR') : '—')}</p>
                    </div>
                    <div className={`px-4 py-2.5 rounded-2xl font-black text-2xl shrink-0 ${scoreClass}`}>
                      {score.toFixed(1)}
                    </div>
                  </div>

                  <div className="p-6 space-y-5">
                    {sub.teacher_feedback && (
                      <div className={`${isManualGrade ? 'bg-gradient-cosmic' : 'bg-gradient-aurora'} p-1 rounded-2xl ${isManualGrade ? '' : 'shadow-glow-cyan'}`}>
                        <div className="bg-white dark:bg-slate-900 p-5 rounded-[14px] flex gap-4">
                          <MessageSquare className={isManualGrade ? 'text-vibe-pink shrink-0' : 'text-vibe-purple shrink-0'} size={24}/>
                          <div className="flex-1">
                            <div className="flex justify-between items-center mb-2 gap-2">
                               <h4 className="font-black text-slate-700 dark:text-slate-200 text-xs uppercase tracking-widest">{isManualGrade ? '📝 Observação do Professor' : '💬 Feedback do Professor'}</h4>
                               {!isManualGrade && (
                                 <button onClick={() => handleRedo(sub.lesson_title)} className="flex items-center gap-1.5 bg-gradient-vibe text-white px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest hover:scale-105 hover:shadow-glow-pink transition-all shadow-md">
                                   <RotateCcw size={12}/> Refazer
                                 </button>
                               )}
                            </div>
                            <p className="text-slate-700 dark:text-slate-300 text-sm leading-relaxed italic font-medium">"{sub.teacher_feedback}"</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Correção ENEM por competência (quando aplicável) */}
                    {sub.ai_feedback?.enem && (
                      <div className="bg-gradient-fire p-1 rounded-2xl shadow-glow-orange">
                        <div className="bg-white dark:bg-slate-900 p-5 rounded-[14px]">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="font-black text-slate-700 dark:text-slate-200 text-xs uppercase tracking-widest">📋 Correção ENEM por Competência</h4>
                            <span className="text-sm font-black text-vibe-orange">{sub.ai_feedback.enem.totalScore}<span className="text-[10px] text-slate-400">/1000</span></span>
                          </div>
                          <div className="grid grid-cols-5 gap-1.5">
                            {(['c1','c2','c3','c4','c5'] as const).map((k, i) => {
                              const c = sub.ai_feedback.enem[k];
                              const pct = (c.score / 200) * 100;
                              return (
                                <div key={k} className="text-center bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg">
                                  <p className="text-[9px] font-black text-vibe-orange uppercase">C{i+1}</p>
                                  <p className="text-sm font-black text-slate-800 dark:text-slate-100">{c.score}</p>
                                  <div className="h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mt-1">
                                    <div className="h-full bg-gradient-fire" style={{ width: `${pct}%` }}></div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <details className="text-sm group mt-3">
                            <summary className="cursor-pointer font-black text-vibe-purple uppercase text-[10px] tracking-[0.25em] hover:underline list-none">
                              📋 Ver detalhes de cada competência
                            </summary>
                            <div className="mt-3 space-y-2">
                              {(['c1','c2','c3','c4','c5'] as const).map((k, i) => {
                                const c = sub.ai_feedback.enem[k];
                                const labels = ['Norma culta','Tema','Argumentação','Coesão','Intervenção'];
                                return (
                                  <div key={k} className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-2 border border-slate-100 dark:border-slate-700">
                                    <p className="text-[10px] font-black text-vibe-orange uppercase tracking-widest">C{i+1} · {labels[i]} · {c.score}/200</p>
                                    <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed mt-1">{c.feedback}</p>
                                  </div>
                                );
                              })}
                            </div>
                          </details>
                        </div>
                      </div>
                    )}

                    {!isManualGrade && (
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-5 rounded-2xl border border-slate-200 dark:border-slate-800">
                      <h4 className="font-black text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2 text-xs uppercase tracking-widest">
                        <Star size={14} className="text-vibe-orange fill-vibe-orange"/> Análise da IA
                      </h4>
                      <p className="text-slate-600 dark:text-slate-400 text-xs italic leading-relaxed">"{sub.ai_feedback?.generalComment || 'Atividade processada com sucesso pelo sistema.'}"</p>
                    </div>
                    )}

                    {!isManualGrade && <details className="text-sm group">
                      <summary className="cursor-pointer font-black text-slate-400 dark:text-slate-500 hover:text-vibe-pink transition-colors flex items-center gap-2 select-none uppercase text-[10px] tracking-[0.25em]">
                         👀 Visualizar respostas
                      </summary>
                      <div className="mt-4 space-y-2 pt-4 border-t border-slate-100 dark:border-slate-800">
                        {sub.content?.map((item: any, i: number) => (
                          <div key={i} className="text-xs text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800/50 p-3 rounded-xl border dark:border-slate-800">
                             <b className="text-vibe-purple block mb-1 uppercase tracking-widest text-[10px]">P{i+1}: {item.question}</b>
                             <span className="text-slate-800 dark:text-slate-300">R: {item.answer}</span>
                          </div>
                        ))}
                      </div>
                    </details>}
                  </div>
                </div>
              </div>
            );})}
          </div>
        )}
      </div>
    </div>
  );
};
