
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { subjectsInfo } from '../data';
import { TEACHER_INFO } from '../data_admin';
import { BookOpen, GraduationCap, ChevronRight, BrainCircuit, BellRing, Loader2, Clock, MapPin, CheckCircle2, Crosshair, ExternalLink } from 'lucide-react';
import { Subject } from '../types';
import { curriculumData } from '../data';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { isItemTargetedAtClass } from '../data_helpers';
import { getCurrentPosition, haversineDistance, formatDistance } from '../lib/geo';

export const Home: React.FC = () => {
  const navigate = useNavigate();
  const { student, isLoading } = useAuth();
  const [exams, setExams] = useState<any[]>([]);
  const [finishedExamTitles, setFinishedExamTitles] = useState<string[]>([]);
  const [finishedExamIds, setFinishedExamIds] = useState<Set<string>>(new Set());
  const [publishedCountBySubject, setPublishedCountBySubject] = useState<Record<string, number>>({});
  const [attendanceToday, setAttendanceToday] = useState<any | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceMsg, setAttendanceMsg] = useState<{ type: 'ok' | 'err' | 'info'; text: string } | null>(null);

  useEffect(() => {
    if (!isLoading && !student) {
      navigate('/login');
    } else if (student) {
      fetchExamsAndHistory();
      checkAttendanceToday();
    }
  }, [student, isLoading, navigate]);

  const checkAttendanceToday = async () => {
    if (!student) return;
    try {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const { data } = await supabase
        .from('attendance_records')
        .select('id, status, created_at, distance_meters')
        .eq('student_id', student.id)
        .gte('created_at', start.toISOString())
        .order('created_at', { ascending: false })
        .limit(1);
      if (data && data[0]) setAttendanceToday(data[0]);
    } catch (e) {
      // tabela pode ainda não existir — silencioso
    }
  };

  const handleMarkAttendance = async () => {
    if (!student || attendanceLoading) return;
    setAttendanceLoading(true);
    setAttendanceMsg(null);
    try {
      // 1. Busca config da escola
      const { data: locs, error: locErr } = await supabase
        .from('school_locations')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1);
      if (locErr) throw locErr;
      const loc = (locs && locs[0]) || null;
      if (!loc) {
        setAttendanceMsg({ type: 'err', text: 'O professor ainda não configurou a localização da escola.' });
        return;
      }

      // 2. Pede posição
      const pos = await getCurrentPosition({ highAccuracy: true, timeoutMs: 20000 });

      // 3. Calcula distância
      const dist = haversineDistance(pos.latitude, pos.longitude, loc.latitude, loc.longitude);
      const radius = Number(loc.radius_meters) || 150;

      if (dist > radius) {
        setAttendanceMsg({
          type: 'err',
          text: `Você está a ${formatDistance(dist)} da escola (limite: ${formatDistance(radius)}). Aproxime-se e tente de novo.`,
        });
        return;
      }

      // 4. Insere registro
      const payload: any = {
        student_id: student.id,
        student_name: student.name,
        school_class: student.school_class,
        grade: String(student.grade),
        latitude: pos.latitude,
        longitude: pos.longitude,
        accuracy_meters: pos.accuracy_meters,
        distance_meters: dist,
        status: 'present',
      };
      const { data: inserted, error: insErr } = await supabase
        .from('attendance_records')
        .insert(payload)
        .select()
        .single();
      if (insErr) throw insErr;
      setAttendanceToday(inserted);
      setAttendanceMsg({ type: 'ok', text: `✅ Presença registrada! Você estava a ${formatDistance(dist)} da escola.` });
    } catch (e: any) {
      setAttendanceMsg({ type: 'err', text: e?.message || 'Não foi possível registrar a presença.' });
    } finally {
      setAttendanceLoading(false);
    }
  };

  const fetchExamsAndHistory = async () => {
    if (!student) return;

    try {
      // bimonthly_exams.grade pode estar guardado como text ou number; tentamos ambos
      const gradeStr = String(student.grade);
      const { data: examsData, error: examsErr } = await supabase
        .from('bimonthly_exams')
        .select('*')
        .eq('grade', gradeStr)
        .order('created_at', { ascending: false });
      if (examsErr) throw examsErr;

      const examData = (examsData || []).filter((exam: any) =>
        isItemTargetedAtClass(exam, String(student.school_class).trim())
      );

      const { data: subsData, error: subsErr } = await supabase
        .from('submissions')
        .select('lesson_title, lesson_id')
        .eq('student_id', student.id);
      if (subsErr) throw subsErr;

      // Considera tanto simulados ("Avaliação Bimestral" / título custom)
      // quanto redações ("Redação: <título>") como já realizados.
      // Usa tanto o título quanto o lesson_id (uuid) — o ID é mais confiável
      // pois não depende de correspondência exata de string.
      const subData = (subsData || [])
        .map((s: any) => (s.lesson_title || '').trim())
        .filter((title: string) => title.length > 0);

      const subIds = new Set<string>(
        (subsData || []).map((s: any) => s.lesson_id).filter(Boolean)
      );

      setExams(examData);
      setFinishedExamTitles(subData);
      setFinishedExamIds(subIds);

      // Conta atividades publicadas por matéria, restritas à série do aluno
      const myGradeNum = Number(student.grade);
      const lessonIdsOfMyGrade = new Set<string>();
      const lessonSubjectMap: Record<string, string> = {};
      curriculumData.forEach((g) => {
        if (g.id !== myGradeNum) return;
        g.bimesters.forEach((b) => {
          b.lessons.forEach((l) => {
            lessonIdsOfMyGrade.add(l.id);
            lessonSubjectMap[l.id] = l.subject;
          });
        });
      });

      // `activities` só tem a coluna `school_classes` (jsonb). Pedir
      // `school_class` (singular) gera erro 400 no PostgREST e zera a
      // contagem de atividades de todas as matérias.
      const [actsRes, qsRes] = await Promise.all([
        supabase.from('activities').select('lesson_id,school_classes'),
        supabase.from('questions').select('lesson_id'),
      ]);

      const lessonIdsWithQuestions = new Set<string>();
      (qsRes.data || []).forEach((row: any) => {
        if (row.lesson_id) lessonIdsWithQuestions.add(row.lesson_id);
      });

      const myClass = String(student.school_class).trim();
      const counts: Record<string, number> = {};
      (actsRes.data || []).forEach((row: any) => {
        const lid = row.lesson_id;
        if (!lid || !lessonIdsOfMyGrade.has(lid) || !lessonIdsWithQuestions.has(lid)) return;
        // Respeita segmentação da atividade pela turma do aluno
        if (!isItemTargetedAtClass(row, myClass)) return;
        const subj = lessonSubjectMap[lid];
        if (!subj) return;
        counts[subj] = (counts[subj] || 0) + 1;
      });
      setPublishedCountBySubject(counts);
    } catch (e: any) {
      // Log detalhado: imprime mensagem, código e detalhes do erro Supabase
      console.error('Erro ao buscar provas e histórico:',
        e?.message || e, e?.code ? `(code: ${e.code})` : '',
        e?.details ? `details: ${e.details}` : '',
        e?.hint ? `hint: ${e.hint}` : ''
      );
    }
  };

  if (isLoading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin"/></div>;
  if (!student) return null;

  // Filtra apenas avaliações que ele AINDA NÃO fez.
  // Funciona tanto para simulados quanto para redações:
  //   - redação:  lesson_title = "Redação: <título>"
  //   - simulado: lesson_title = "Avaliação Bimestral: Xº Bimestre" (ou customizado)
  const now = new Date();
  const pendingExams = exams.filter(e => {
    // Ainda não liberado (agendamento futuro)
    if (e.starts_at && new Date(e.starts_at) > now) return false;
    // Prazo encerrado — não mostra mais para o aluno
    if (e.expires_at && new Date(e.expires_at) < now) return false;
    // Verifica primeiro por ID (mais confiável — não depende de correspondência de string)
    if (finishedExamIds.has(e.id)) return false;
    // Fallback por título (para submissões antigas sem lesson_id preenchido)
    const isEssayItem = e.type === 'essay' || e.questions?.[0]?.type === 'essay';
    const expectedTitle = isEssayItem
      ? `Redação: ${(e.title || 'Redação').trim()}`
      : (e.title?.trim() || `Avaliação Bimestral: ${e.bimester}º Bimestre`);
    return !finishedExamTitles.includes(expectedTitle.trim());
  });

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 animate-in fade-in duration-500 pb-20 transition-colors duration-300 relative overflow-hidden">
      {/* Mesh gradient sutil de fundo */}
      <div className="absolute inset-0 bg-mesh-bg opacity-60 dark:opacity-20 pointer-events-none"></div>

      <div className="relative bg-gradient-cosmic border-b border-white/10 text-white py-20 px-4 overflow-hidden">
        {/* Blobs decorativos */}
        <div className="absolute top-0 right-1/4 w-72 h-72 bg-vibe-cyan/30 rounded-full blur-3xl animate-blob"></div>
        <div className="absolute -bottom-20 left-1/4 w-72 h-72 bg-vibe-pink/30 rounded-full blur-3xl animate-blob" style={{ animationDelay: '3s' }}></div>
        <div className="container mx-auto max-w-4xl text-center relative z-10">
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-white/70 mb-3">✨ Bem-vindo de volta</p>
          <h2 className="text-5xl md:text-6xl font-black mb-4 font-display tracking-tighter">Olá, <span className="text-vibe-lime drop-shadow-[0_0_30px_rgba(163,230,53,0.6)]">{student.name.split(' ')[0]}</span> 👋</h2>
          <p className="text-white/80 text-lg font-medium">Suas atividades da <span className="text-vibe-lime font-black">{student.grade}ª Série</span></p>
        </div>
      </div>

      <div className="container mx-auto px-4 max-w-6xl -mt-10 space-y-12 relative z-10">
        {/* Botão de Frequência por Geolocalização */}
        <div className="relative overflow-hidden bg-gradient-ocean p-1 rounded-[40px] shadow-glow-cyan animate-in zoom-in duration-500">
          <div className="bg-white dark:bg-slate-900 rounded-[36px] p-7 flex flex-col md:flex-row md:items-center gap-5">
            <div className="w-16 h-16 bg-gradient-ocean rounded-2xl flex items-center justify-center text-white shadow-glow-cyan shrink-0">
              <MapPin size={30} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-2xl font-black tracking-tighter font-display">
                <span className="text-gradient-aurora">📍 Frequência de hoje</span>
              </h3>
              {attendanceToday ? (
                <p className="text-emerald-600 dark:text-emerald-400 text-sm font-bold mt-1 flex items-center gap-2">
                  <CheckCircle2 size={16} />
                  Presença já registrada às {new Date(attendanceToday.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              ) : (
                <p className="text-slate-500 dark:text-slate-400 text-xs font-bold mt-1">
                  Clique no botão pra marcar presença. Você precisa estar dentro da escola — o app verifica sua localização.
                </p>
              )}
              {attendanceMsg && (
                <div className={`mt-3 px-4 py-2 rounded-2xl text-xs font-bold ${
                  attendanceMsg.type === 'ok' ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' :
                  attendanceMsg.type === 'err' ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300' :
                  'bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300'
                }`}>
                  {attendanceMsg.text}
                </div>
              )}
            </div>
            <button
              onClick={handleMarkAttendance}
              disabled={attendanceLoading || !!attendanceToday}
              className={`shrink-0 px-7 py-4 rounded-2xl font-black text-sm uppercase tracking-wider transition-all flex items-center gap-2 ${
                attendanceToday
                  ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 cursor-not-allowed'
                  : attendanceLoading
                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-500 cursor-wait'
                    : 'bg-gradient-ocean text-white shadow-glow-cyan hover:scale-105 active:scale-95'
              }`}
            >
              {attendanceLoading ? (
                <><Loader2 size={18} className="animate-spin" /> Localizando…</>
              ) : attendanceToday ? (
                <><CheckCircle2 size={18} /> Presente ✓</>
              ) : (
                <><Crosshair size={18} /> ✋ Marcar Presença</>
              )}
            </button>
          </div>
        </div>

        {/* Portal do Aluno — SEDUC Tocantins */}
        <a
          href="https://portaldoaluno.seduc.to.pontoid.com.br/Home/Login"
          target="_blank"
          rel="noopener noreferrer"
          className="relative overflow-hidden bg-gradient-to-br from-emerald-500 to-teal-700 p-1 rounded-[32px] shadow-xl hover:-translate-y-1 hover:scale-[1.02] transition-all group animate-in zoom-in duration-500"
        >
          <div className="bg-white dark:bg-slate-900 rounded-[28px] p-6 flex items-center gap-5">
            <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-teal-700 rounded-2xl flex items-center justify-center text-white text-2xl shrink-0 shadow-md group-hover:scale-110 group-hover:rotate-6 transition-transform duration-300">
              🎓
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-black tracking-tight font-display text-slate-800 dark:text-slate-100">Portal do Aluno — SEDUC Tocantins</h3>
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-1">Consulte seus boletins e notas no sistema do Estado</p>
            </div>
            <ExternalLink size={18} className="text-emerald-400 group-hover:text-emerald-600 shrink-0 transition-colors" />
          </div>
        </a>

        {pendingExams.length > 0 && (
           <div className="relative overflow-hidden bg-gradient-fire p-1 rounded-[40px] shadow-glow-orange animate-in zoom-in duration-500">
            <div className="bg-white dark:bg-slate-900 rounded-[36px] p-8">
              <div className="flex items-center gap-4 mb-6">
                 <div className="w-14 h-14 bg-gradient-fire rounded-2xl flex items-center justify-center text-white shadow-glow-orange animate-pulse-glow">
                    <BrainCircuit size={26}/>
                 </div>
                 <div>
                    <h3 className="text-2xl font-black tracking-tighter font-display">
                      <span className="text-gradient-sunset">🔥 Avaliações Pendentes</span>
                    </h3>
                    <p className="text-slate-500 dark:text-slate-400 text-[10px] font-black uppercase tracking-[0.25em] mt-1">Simulados e redações pra fazer</p>
                 </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 {pendingExams.map(exam => {
                   const isEssayItem = exam.type === 'essay' || exam.questions?.[0]?.type === 'essay';
                   const subjInfo = !isEssayItem ? subjectsInfo[exam.subject as Subject] : null;
                   return (
                    <Link
                      key={exam.id}
                      to={`/evaluation/${exam.id}`}
                      className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-amber-100 dark:border-amber-900 hover:border-amber-400 dark:hover:border-amber-600 hover:shadow-lg transition-all group flex items-center justify-between gap-3"
                    >
                       <div className="flex items-center gap-4 min-w-0">
                          <div className={`w-12 h-12 ${isEssayItem ? 'bg-gradient-fire' : subjInfo?.color} rounded-xl flex items-center justify-center text-white text-2xl shrink-0 group-hover:scale-110 transition-transform`}>
                             {isEssayItem ? '✍️' : subjInfo?.icon}
                          </div>
                          <div className="min-w-0">
                             {/* Badge da disciplina */}
                             {!isEssayItem && subjInfo && (
                               <span className={`inline-flex items-center gap-1 ${subjInfo.color} text-white text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full mb-1`}>
                                 {subjInfo.icon} {subjInfo.name}
                               </span>
                             )}
                             {isEssayItem && (
                               <span className="inline-flex items-center gap-1 bg-gradient-fire text-white text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full mb-1">
                                 ✍️ Redação
                               </span>
                             )}
                             <h4 className="font-bold text-slate-800 dark:text-slate-100 text-sm leading-tight">
                               {isEssayItem
                                 ? (exam.title || 'Redação')
                                 : (exam.title || `Simulado ${subjInfo?.name || ''} — ${exam.bimester}º Bimestre`)}
                             </h4>
                             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">
                               {exam.bimester}º Bimestre · {exam.school_class || 'Todas turmas'}
                             </p>
                             {exam.expires_at && (() => {
                               const exp = new Date(exam.expires_at);
                               const diffMs = exp.getTime() - now.getTime();
                               const diffH = Math.floor(diffMs / 3600000);
                               const diffD = Math.floor(diffMs / 86400000);
                               const urgentColor = diffH < 24 ? 'text-red-500' : diffH < 72 ? 'text-amber-500' : 'text-slate-400';
                               const label = diffH < 1
                                 ? `⏰ Menos de 1h`
                                 : diffH < 24
                                 ? `⏰ ${diffH}h restantes`
                                 : `⏰ Prazo: ${exp.toLocaleDateString('pt-BR')} às ${exp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
                               return <p className={`text-[9px] font-black uppercase tracking-widest mt-0.5 ${urgentColor}`}>{label}</p>;
                             })()}
                          </div>
                       </div>
                       <ChevronRight className="text-amber-200 dark:text-amber-800 group-hover:text-vibe-pink group-hover:translate-x-1 transition-all shrink-0" />
                    </Link>
                   );
                 })}
              </div>
            </div>
           </div>
        )}

        {Object.values(publishedCountBySubject).reduce((a: number, b: number) => a + b, 0) === 0 && (
          <div className="relative overflow-hidden bg-gradient-aurora p-1 rounded-[40px] shadow-glow-cyan">
            <div className="bg-white dark:bg-slate-900 rounded-[36px] p-12 text-center">
              <div className="w-20 h-20 bg-gradient-aurora rounded-full flex items-center justify-center mx-auto mb-5 shadow-glow-cyan animate-float">
                <Clock className="text-white" size={36} />
              </div>
              <h3 className="text-2xl font-black tracking-tighter font-display mb-2">
                <span className="text-gradient-aurora">🌟 Em breve, em breve…</span>
              </h3>
              <p className="text-slate-500 dark:text-slate-400 text-xs font-bold tracking-wide">
                Seu professor ainda não publicou nada. Quando publicar, vai aparecer aqui na hora.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {(Object.keys(subjectsInfo) as Subject[]).map((key) => {
            const info = subjectsInfo[key];
            const count = publishedCountBySubject[key] || 0;
            const hasActivities = count > 0;
            return (
              <Link
                key={key}
                to={`/grade/${student.grade}?subject=${key}`}
                className={`relative overflow-hidden rounded-[32px] p-1 transition-all group ${
                  hasActivities
                    ? `${info.gradient || info.color} ${info.glow || 'shadow-xl'} hover:-translate-y-2 hover:scale-[1.02]`
                    : 'bg-slate-200/60 dark:bg-slate-800/60 opacity-70 hover:opacity-100'
                }`}
              >
                <div className="bg-white dark:bg-slate-900 rounded-[28px] p-7 h-full flex flex-col">
                  <div className={`w-16 h-16 ${hasActivities ? (info.gradient || info.color) : 'bg-slate-200 dark:bg-slate-800'} rounded-2xl flex items-center justify-center text-3xl mb-6 shadow-md ${!hasActivities && 'grayscale'} group-hover:scale-110 group-hover:rotate-6 transition-transform duration-300`}>
                    <span className="drop-shadow">{info.icon}</span>
                  </div>
                  <h3 className="text-xl font-black text-slate-800 dark:text-slate-100 mb-2 font-display tracking-tight">{info.name}</h3>
                  {hasActivities ? (
                    <div className="flex items-center justify-between mt-auto pt-4">
                      <span className="text-[10px] font-black uppercase tracking-widest bg-gradient-to-r from-vibe-pink to-vibe-purple bg-clip-text text-transparent">
                        {count} {count === 1 ? 'atividade' : 'atividades'} 🔥
                      </span>
                      <ChevronRight size={18} className="text-slate-400 group-hover:text-vibe-pink group-hover:translate-x-1 transition-all" />
                    </div>
                  ) : (
                    <div className="flex items-center text-slate-400 dark:text-slate-500 font-bold text-[10px] uppercase tracking-widest mt-auto pt-4">
                      Aguardando · em breve
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
};
