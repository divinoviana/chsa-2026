
import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { curriculumData, subjectsInfo } from '../data';
import { Book, ArrowLeft, ShieldAlert, ChevronRight, BrainCircuit, CheckCircle2, Clock, Award, Lock } from 'lucide-react';
import { Subject } from '../types';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { isItemTargetedAtClass } from '../data_helpers';

export const GradeView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { student, isLoading } = useAuth();
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [exams, setExams] = useState<any[]>([]);
  const [userSubmissions, setUserSubmissions] = useState<string[]>([]);
  const [publishedLessonIds, setPublishedLessonIds] = useState<string[]>([]);
  const [activityExpiresMap, setActivityExpiresMap] = useState<Record<string, string>>({});
  const [activityStartsMap, setActivityStartsMap] = useState<Record<string, string>>({});
  const [lessonTitleOverrides, setLessonTitleOverrides] = useState<Record<string, string>>({});
  const [loadingExams, setLoadingExams] = useState(true);
  
  const subjectKey = searchParams.get('subject') as Subject || 'filosofia';
  const grade = curriculumData.find(g => g.id === Number(id));
  const subject = subjectsInfo[subjectKey];

  useEffect(() => {
    if (!isLoading) {
      if (!student) {
        navigate('/login');
      } else if (Number(student.grade) !== Number(id)) {
        setIsAuthorized(false);
      } else {
        setIsAuthorized(true);
        fetchExamsAndStatus();
      }
    }
  }, [id, student, isLoading, navigate, subjectKey]);

  const fetchExamsAndStatus = async () => {
    if (!student || !subjectKey) return;
    setLoadingExams(true);
    try {
      const gradeStr = String(id);
      const { data: examsData, error: examsErr } = await supabase
        .from('bimonthly_exams')
        .select('*')
        .eq('grade', gradeStr)
        .eq('subject', subjectKey)
        .order('created_at', { ascending: false });
      if (examsErr) throw examsErr;

      const filteredExams = (examsData || [])
        // Redações NÃO entram na seção "Avaliação Bimestral" — elas
        // aparecem como pendência na Home. Sem esse filtro a redação
        // era renderizada como se fosse um simulado (efeito "duplicado").
        .filter((exam: any) => exam.type !== 'essay' && exam.questions?.[0]?.type !== 'essay')
        .filter((exam: any) =>
          isItemTargetedAtClass(exam, String(student.school_class).trim())
        );

      const { data: subsData, error: subsErr } = await supabase
        .from('submissions')
        .select('lesson_id, lesson_title')
        .eq('student_id', student.id)
        .eq('subject', subjectKey);
      if (subsErr) throw subsErr;

      const subsKeys = (subsData || []).map((s: any) =>
        s.lesson_id || (s.lesson_title || '').trim()
      );

      // Aluno só vê aulas onde o professor publicou atividade COM ao menos uma questão
      // e que esteja segmentada pra turma dele (ou pra todas).
      // IMPORTANTE: a tabela `activities` só tem `school_classes` (jsonb).
      // Pedir `school_class` (singular) faz o PostgREST devolver 400 e
      // o aluno acaba sem ver NENHUMA atividade. Selecionamos só o que existe.
      // Coleta todos os lesson_ids desta série/matéria para buscar overrides
      const gradeData = curriculumData.find(g => g.id === Number(id));
      const allLessonIds = gradeData
        ? gradeData.bimesters.flatMap(b => b.lessons.filter(l => l.subject === subjectKey).map(l => l.id))
        : [];

      const [actsRes, qsRes, overridesRes] = await Promise.all([
        // Filtra por lesson_ids da série/matéria — evita scan total de activities
        allLessonIds.length > 0
          ? supabase.from('activities').select('lesson_id,school_classes,expires_at,starts_at').in('lesson_id', allLessonIds)
          : supabase.from('activities').select('lesson_id,school_classes,expires_at,starts_at'),
        supabase.from('questions').select('lesson_id').eq('subject', subjectKey),
        allLessonIds.length > 0
          ? supabase.from('lesson_overrides').select('id, data').in('id', allLessonIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      const overrideMap: Record<string, string> = {};
      ((overridesRes as any).data || []).forEach((o: any) => {
        if (o.data?.title) overrideMap[o.id] = o.data.title;
      });
      setLessonTitleOverrides(overrideMap);

      const lessonIdsWithQuestions = new Set<string>();
      (qsRes.data || []).forEach((row: any) => {
        if (row.lesson_id) lessonIdsWithQuestions.add(row.lesson_id);
      });

      const myClass = String(student.school_class).trim();
      const publishedIds = new Set<string>();
      const expiresMap: Record<string, string> = {};
      const startsMap: Record<string, string> = {};
      const nowIso = new Date();
      (actsRes.data || []).forEach((row: any) => {
        if (!row.lesson_id || !lessonIdsWithQuestions.has(row.lesson_id)) return;
        if (!isItemTargetedAtClass(row, myClass)) return;
        // Não mostra atividades agendadas para o futuro
        if (row.starts_at && new Date(row.starts_at) > nowIso) return;
        publishedIds.add(row.lesson_id);
        if (row.expires_at) expiresMap[row.lesson_id] = row.expires_at;
        if (row.starts_at) startsMap[row.lesson_id] = row.starts_at;
      });
      setActivityExpiresMap(expiresMap);
      setActivityStartsMap(startsMap);

      setExams(filteredExams);
      setUserSubmissions(subsKeys);
      setPublishedLessonIds(Array.from(publishedIds));
    } catch (e) {
      console.error('Erro ao buscar provas/lições:', e);
    } finally {
      setLoadingExams(false);
    }
  };

  if (isLoading || isAuthorized === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-tocantins-blue rounded-full animate-spin"></div>
      </div>
    );
  }

  if (isAuthorized === false) return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6 text-center">
      <div className="bg-white p-10 rounded-3xl shadow-2xl max-w-md border border-red-100">
        <ShieldAlert className="w-16 h-16 text-red-600 mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-4">Série Incorreta</h2>
        <p className="text-slate-500 mb-6">Você está cadastrado na {student?.grade}ª Série e tentou acessar a {id}ª Série.</p>
        <Link to="/" className="block bg-slate-900 text-white p-4 rounded-xl font-bold">Voltar ao Meu Painel</Link>
      </div>
    </div>
  );

  if (!grade || !subject) return null;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 animate-in fade-in duration-500 pb-20 relative overflow-hidden">
      <div className="absolute inset-0 bg-mesh-bg opacity-50 dark:opacity-15 pointer-events-none"></div>

      <div className={`relative ${subject.gradient || subject.color} py-20 text-white overflow-hidden`}>
        {/* Blobs decorativos no header */}
        <div className="absolute top-0 right-0 w-72 h-72 bg-white/20 rounded-full blur-3xl animate-blob"></div>
        <div className="absolute -bottom-20 left-1/4 w-72 h-72 bg-black/10 rounded-full blur-3xl animate-blob" style={{ animationDelay: '3s' }}></div>

        <div className="container mx-auto px-4 max-w-4xl relative z-10">
          <Link to="/" className="inline-flex items-center gap-2 text-white/90 hover:text-white mb-6 text-xs font-black tracking-widest uppercase bg-white/10 hover:bg-white/20 px-4 py-2 rounded-full backdrop-blur-md transition-all hover:scale-105">
            <ArrowLeft size={14}/> Mudar Disciplina
          </Link>
          <div className="flex items-center gap-6">
             <div className="w-24 h-24 bg-white/20 rounded-[32px] flex items-center justify-center text-5xl shadow-2xl border border-white/20 backdrop-blur-md animate-float">
                {subject.icon}
             </div>
             <div>
                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-white/70 mb-2">📚 Disciplina</p>
                <h1 className="text-4xl md:text-5xl font-black tracking-tighter font-display drop-shadow-lg">{subject.name}</h1>
                <p className="text-white/80 font-bold uppercase tracking-widest text-[11px] mt-1">{grade.title} · Conteúdo e Avaliações</p>
             </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12 max-w-4xl -mt-10 relative z-10">
        <div className="space-y-12">

          {(exams.length > 0 || loadingExams) && (
            <section className="animate-in slide-in-from-bottom-4 duration-700">
              <div className="flex items-center gap-2 mb-6 ml-2">
                <Award className="text-vibe-purple" size={22} />
                <h2 className="text-2xl font-black tracking-tighter font-display">
                  <span className="text-gradient-cosmic">🎯 Avaliação Bimestral</span>
                </h2>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {loadingExams ? (
                  <div className="bg-white dark:bg-slate-900 p-8 rounded-[32px] border-2 border-dashed border-vibe-purple/30 flex items-center justify-center gap-3 text-slate-400 font-bold">
                    <Clock className="animate-spin text-vibe-purple" size={18}/> Sincronizando…
                  </div>
                ) : (
                  exams.map(exam => {
                    const examTitle = `Avaliação Bimestral: ${exam.bimester}º Bimestre`;
                    const isDone = userSubmissions.includes(exam.id) || userSubmissions.includes(examTitle);

                    return (
                      <Link
                        key={exam.id}
                        to={isDone ? "#" : `/evaluation/${exam.id}`}
                        className={`relative overflow-hidden rounded-[32px] p-1 transition-all group ${isDone ? 'bg-slate-200/60 dark:bg-slate-800/60 opacity-80 cursor-default grayscale' : 'bg-gradient-cosmic shadow-glow-purple hover:-translate-y-1 hover:scale-[1.01]'}`}
                        onClick={(e) => isDone && e.preventDefault()}
                      >
                       <div className="bg-white dark:bg-slate-900 p-6 rounded-[28px] flex items-center justify-between">
                         <div className="flex items-center gap-5">
                            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-transform group-hover:scale-110 group-hover:rotate-6 ${isDone ? 'bg-slate-200 text-slate-500' : 'bg-gradient-cosmic text-white shadow-glow-purple'}`}>
                               {isDone ? <Lock size={26}/> : <BrainCircuit size={26}/>}
                            </div>
                            <div>
                               <h4 className="font-black text-slate-800 uppercase tracking-tight text-sm">
                                 {isDone ? 'Avaliação Encerrada' : `Simulado do ${exam.bimester}º Bimestre`}
                               </h4>
                               <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                                 {isDone ? 'Nota já registrada no sistema' : `Realize sua única tentativa agora`}
                               </p>
                            </div>
                         </div>
                         <div className="flex items-center gap-4">
                            {isDone ? (
                              <span className="bg-slate-100 text-slate-500 px-4 py-2 rounded-full text-[10px] font-black uppercase">✓ Realizada</span>
                            ) : (
                              <>
                                <span className="hidden sm:inline-flex bg-gradient-cosmic text-white px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest shadow-md">🚀 Fazer Agora</span>
                                <ChevronRight className="text-vibe-purple/40 group-hover:text-vibe-pink group-hover:translate-x-1 transition-all" />
                              </>
                            )}
                         </div>
                       </div>
                      </Link>
                    );
                  })
                )}
              </div>
            </section>
          )}

          <section>
            <div className="flex items-center gap-2 mb-6 ml-2">
              <Book className="text-vibe-cyan" size={22} />
              <h2 className="text-2xl font-black tracking-tighter font-display">
                <span className="text-gradient-aurora">📖 Roteiro de Estudos</span>
              </h2>
            </div>
            
            <div className="space-y-8">
              {grade.bimesters.map((bimester) => {
                const filteredLessons = bimester.lessons.filter(l => l.subject === subjectKey);
                const publishedInBimester = filteredLessons.filter(l => publishedLessonIds.includes(l.id));
                
                if (publishedInBimester.length === 0) return null;

                const displayTitle = bimester.subjectTitles?.[subjectKey] || bimester.title;

                return (
                  <div key={bimester.id} className={`relative overflow-hidden ${subject.gradient || subject.color} p-1 rounded-[40px] shadow-lg`}>
                    <div className="bg-white dark:bg-slate-900 rounded-[36px] overflow-hidden">
                      <div className="bg-slate-50/70 dark:bg-slate-800/50 px-8 py-5 border-b dark:border-slate-800 flex justify-between items-center">
                         <h3 className="font-black text-slate-800 dark:text-slate-100 text-xs uppercase tracking-[0.25em]">{displayTitle}</h3>
                         <span className="bg-gradient-vibe text-white px-3 py-1.5 rounded-full text-[9px] font-black tracking-widest shadow-md">{publishedInBimester.length} aulas 🔥</span>
                      </div>
                      <div className="divide-y divide-slate-50 dark:divide-slate-800">
                        {filteredLessons.map((lesson) => {
                          const isPublished = publishedLessonIds.includes(lesson.id);
                          const isLessonDone = userSubmissions.includes(lesson.id) || userSubmissions.includes(lesson.title.trim());

                          if (!isPublished) return null;

                          const expiresAt = activityExpiresMap[lesson.id];
                          const now = new Date();
                          const isExpired = expiresAt ? new Date(expiresAt) < now : false;

                          const deadlineBadge = (() => {
                            if (!expiresAt) return null;
                            if (isExpired) return <span className="text-[9px] font-black text-red-500 uppercase tracking-widest">🔒 Prazo encerrado</span>;
                            const diffMs = new Date(expiresAt).getTime() - now.getTime();
                            const diffH = Math.floor(diffMs / 3600000);
                            const color = diffH < 24 ? 'text-red-500' : diffH < 72 ? 'text-amber-500' : 'text-slate-400';
                            const label = diffH < 1 ? '⏰ Menos de 1h' : diffH < 24 ? `⏰ ${diffH}h restantes` : `⏰ Prazo: ${new Date(expiresAt).toLocaleDateString('pt-BR')}`;
                            return <span className={`text-[9px] font-black uppercase tracking-widest ${color}`}>{label}</span>;
                          })();

                          if (isExpired && !isLessonDone) {
                            return (
                              <div key={lesson.id} className="flex items-center p-6 opacity-50 cursor-not-allowed">
                                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mr-5 bg-slate-100 dark:bg-slate-800 text-slate-400">
                                  <Lock size={20}/>
                                </div>
                                <div className="flex-1">
                                  <span className="font-bold text-sm block text-slate-400">{lessonTitleOverrides[lesson.id] || lesson.title}</span>
                                  {deadlineBadge}
                                </div>
                              </div>
                            );
                          }

                          return (
                            <Link key={lesson.id} to={`/lesson/${lesson.id}`} className="flex items-center p-6 hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition group">
                               <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all mr-5 ${isLessonDone ? 'bg-vibe-lime/20 text-vibe-lime' : `bg-slate-100 dark:bg-slate-800 text-slate-400 group-hover:${subject.gradient || subject.color} group-hover:text-white group-hover:rotate-6 group-hover:scale-110`}`}>
                                 {isLessonDone ? <CheckCircle2 size={20}/> : <Book size={20}/>}
                               </div>
                               <div className="flex-1">
                                  <span className={`font-bold text-sm block transition-colors ${isLessonDone ? 'text-slate-400' : 'text-slate-700 dark:text-slate-200 group-hover:text-vibe-pink'}`}>
                                    {lessonTitleOverrides[lesson.id] || lesson.title}
                                  </span>
                                  {isLessonDone
                                    ? <span className="text-[9px] font-black text-vibe-lime uppercase tracking-widest">✓ Atividade entregue</span>
                                    : deadlineBadge
                                  }
                               </div>
                               <ChevronRight size={18} className="text-slate-200 dark:text-slate-700 group-hover:text-vibe-pink transition-all group-hover:translate-x-1"/>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
