
import React, { useState } from 'react';
import { Send, CheckCircle, Database, Loader2 } from 'lucide-react';
import { AIResponse, evaluateActivities } from '../services/aiService';
import { supabase } from '../lib/supabase';
import { Subject } from '../types';
import { useAuth } from '../context/AuthContext';

export interface SubmissionItem {
  activityTitle: string;
  question: string;
  answer: string;
  correctAnswer?: string;
}

interface Props {
  studentName: string;
  schoolClass: string;
  submissionDate: string;
  lessonId: string;
  lessonTitle: string;
  subject: Subject;
  submissionData: SubmissionItem[];
  aiData?: AIResponse | null;
  theory: string;
  integrityData?: {
    tab_switches: number;
    paste_attempts: number;
    extension_detected: boolean;
    programmatic_inputs: number;
    suspicion_level: string;
  } | null;
}

export const SubmissionBar: React.FC<Props> = ({
  studentName,
  schoolClass,
  submissionDate,
  lessonId,
  lessonTitle,
  subject,
  submissionData,
  aiData,
  theory,
  integrityData,
}) => {
  const { student } = useAuth();
  const [isGenerating, setIsGenerating] = useState(false);
  const [dbStatus, setDbStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const handleInternalSend = async () => {
    const safeStudentName = studentName?.trim() || student?.name || 'Estudante';
    const safeSchoolClass = schoolClass?.trim() || student?.school_class || 'N/A';

    if (submissionData.length === 0) {
      alert("Por favor, responda as atividades antes de finalizar.");
      return;
    }

    setIsGenerating(true);
    setDbStatus('saving');
    
    let currentAIData = aiData;
    try {
      // evaluateActivities NUNCA lança — corrige objetivas localmente e
      // tenta IA pras discursivas. Se IA cair, ainda retorna AIResponse
      // completa com fallback. Por isso não precisamos mais de try/catch aqui.
      if (!currentAIData) {
        const q = submissionData.map(item => ({
          question: item.question,
          answer: item.answer,
          correctAnswer: item.correctAnswer,
        }));
        currentAIData = await evaluateActivities(lessonTitle, theory, q);
      }

      const corrections = currentAIData?.corrections || [];
      const avgScore = corrections.length > 0
        ? corrections.reduce((acc, c) => acc + (Number(c.score) || 0), 0) / corrections.length
        : 0;

      console.log("Iniciando gravação no Supabase...");
      const nowIso = new Date().toISOString();
      const { error } = await supabase.from('submissions').insert({
        student_id: student?.id || null,
        student_name: safeStudentName,
        school_class: safeSchoolClass,
        grade: student?.grade || '1',
        lesson_id: lessonId,
        lesson_title: lessonTitle?.trim() || 'Aula sem título',
        subject: subject,
        submission_date: nowIso,
        submitted_at: nowIso,
        content: submissionData,
        ai_feedback: integrityData ? { ...currentAIData, integrity: integrityData } : currentAIData,
        score: isNaN(avgScore) ? 0 : avgScore,
        status: 'completed',
        teacher_feedback: null,
      });
      if (error) throw error;

      console.log("Gravação concluída com sucesso.");
      setDbStatus('saved');
      alert(`Atividade de ${subject.toUpperCase()} enviada com sucesso ao professor!`);
    } catch (error: any) {
      console.error("Erro fatal ao enviar atividade:", error);
      setDbStatus('error');
      const msg = error instanceof Error ? error.message : String(error);
      alert(`⚠️ Não foi possível enviar a atividade.\n\nErro: ${msg}\n\nVerifique sua conexão e tente novamente. Se o problema persistir, avise seu professor.`);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-xl border-t border-slate-200 p-4 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] z-50">
      <div className="container mx-auto max-w-3xl flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`p-3 rounded-2xl transition-all duration-500 ${dbStatus === 'saved' ? 'bg-vibe-lime/20 text-vibe-lime scale-110 shadow-glow-lime' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
            {dbStatus === 'saved' ? <CheckCircle size={22}/> : <Database size={22}/>}
          </div>
          <div className="hidden sm:block">
            <p className="text-[10px] font-black text-slate-400 uppercase leading-none mb-1 tracking-[0.25em]">Sincronização</p>
            <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
              {dbStatus === 'saving' ? '⏳ Gravando…' :
               dbStatus === 'saved' ? '✅ Sincronizada!' :
               dbStatus === 'error' ? '⚠️ Falha na gravação' : `Pronto pra enviar ao Prof. de ${subject}`}
            </p>
          </div>
        </div>

        <button
          onClick={handleInternalSend}
          disabled={isGenerating || dbStatus === 'saved'}
          className={`relative overflow-hidden font-black py-4 px-8 rounded-2xl flex items-center gap-2 transition-all active:scale-95 hover:scale-[1.03] disabled:opacity-50 ${
            dbStatus === 'saved'
              ? 'bg-vibe-lime text-slate-950 cursor-default shadow-glow-lime'
              : 'bg-gradient-vibe text-white cursor-pointer shadow-glow-purple hover:shadow-glow-pink'
          }`}
        >
          {isGenerating ? <Loader2 className="animate-spin" size={18}/> : <Send size={18}/>}
          <span className="text-sm tracking-tight">{dbStatus === 'saved' ? 'Enviada ✓' : '🚀 Enviar Atividade'}</span>
        </button>
      </div>
    </div>
  );
};
