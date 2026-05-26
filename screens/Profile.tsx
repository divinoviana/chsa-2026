
import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Upload, X, ArrowLeft, Loader2, Save, User, Pencil, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export const Profile: React.FC = () => {
  const { student, updateStudentData } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [newPhoto, setNewPhoto] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [savingName, setSavingName] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const startCamera = async () => {
    setShowCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      alert("Câmera indisponível.");
      setShowCamera(false);
    }
  };

  const takePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      
      // Cap max resolution to prevent exceeding 1MB Firestore limit
      const maxDim = 512;
      let width = video.videoWidth;
      let height = video.videoHeight;
      
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = (maxDim / width) * height;
          width = maxDim;
        } else {
          width = (maxDim / height) * width;
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0, width, height);
      
      // Use lower quality to ensure size is below 1MB
      setNewPhoto(canvas.toDataURL('image/jpeg', 0.6));
      
      const stream = video.srcObject as MediaStream;
      stream.getTracks().forEach(t => t.stop());
      setShowCamera(false);
    }
  };

  const handleSaveName = async () => {
    const trimmed = newName.trim();
    if (!trimmed || !student || trimmed === student.name) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      const { error } = await supabase
        .from('students')
        .update({ name: trimmed })
        .eq('id', student.id);
      if (error) throw error;
      updateStudentData({ name: trimmed });
      setEditingName(false);
    } catch (err: any) {
      alert('Erro ao salvar nome: ' + (err?.message || 'tente novamente.'));
    } finally {
      setSavingName(false);
    }
  };

  const handleSave = async () => {
    if (!newPhoto || !student) return;
    setLoading(true);
    try {
      const profileData: any = {
        id: student.id,
        photo_url: newPhoto,
      };

      // Para admins/professores sem perfil completo de aluno, populamos os requisitos mínimos
      if (!student.grade || !student.school_class) {
        profileData.name = student.name || 'Usuário';
        profileData.email = student.email || '';
        profileData.role = 'admin';
        profileData.grade = student.grade || 'N/A';
        profileData.school_class = student.school_class || 'N/A';
      }

      const { error } = await supabase
        .from('students')
        .upsert(profileData, { onConflict: 'id' });
      if (error) throw error;

      updateStudentData(profileData);
      alert("Foto atualizada com sucesso!");
      setNewPhoto(null);
    } catch (err: any) {
      console.error("Save Profile Error:", err);
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('permission') || msg.includes('rls')) {
        alert("Erro de permissão: você não tem autorização para editar este perfil.");
      } else {
        alert("Erro ao salvar perfil: " + (err?.message || 'tente novamente.'));
      }
    } finally {
      setLoading(false);
    }
  };

  if (!student) return null;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans p-4 transition-colors duration-300 relative overflow-hidden flex items-center justify-center">
      <div className="absolute inset-0 bg-mesh-bg opacity-60 dark:opacity-15 pointer-events-none"></div>
      <div className="absolute -top-32 -left-20 w-96 h-96 bg-vibe-pink/30 rounded-full blur-3xl animate-blob"></div>
      <div className="absolute -bottom-32 -right-20 w-96 h-96 bg-vibe-cyan/30 rounded-full blur-3xl animate-blob" style={{ animationDelay: '3s' }}></div>

      <div className="relative container mx-auto max-w-md bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl rounded-[40px] shadow-2xl border border-white/50 dark:border-slate-800/50 overflow-hidden z-10">
        <div className="p-6 border-b dark:border-slate-800 flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="p-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl dark:text-slate-400 hover:scale-110 transition-all">
            <ArrowLeft size={18} />
          </button>
          <h2 className="text-sm font-black uppercase tracking-[0.3em] font-display">
            <span className="text-gradient-vibe">✨ Meu Perfil</span>
          </h2>
          <div className="w-8" />
        </div>

        <div className="p-8 space-y-8 text-center">
          <div className="relative inline-block group">
            <div className="absolute -inset-2 bg-gradient-vibe rounded-[36px] blur-md opacity-70 animate-pulse-glow"></div>
            <div className="relative w-32 h-32 rounded-[32px] overflow-hidden ring-4 ring-white dark:ring-slate-900 shadow-glow-purple">
              <img src={newPhoto || student.photo_url} className="w-full h-full object-cover" />
            </div>
            {loading && (
              <div className="absolute inset-0 bg-white/60 dark:bg-slate-900/60 flex items-center justify-center rounded-[32px]">
                <Loader2 className="animate-spin text-vibe-purple" />
              </div>
            )}
          </div>

          <div className="space-y-2">
            {editingName ? (
              <div className="flex items-center gap-2 justify-center">
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false); }}
                  className="text-xl font-black tracking-tighter font-display text-center bg-slate-100 dark:bg-slate-800 border-2 border-vibe-purple rounded-xl px-3 py-1 outline-none w-48 dark:text-white"
                  maxLength={60}
                />
                <button onClick={handleSaveName} disabled={savingName} className="p-2 rounded-xl bg-gradient-vibe text-white hover:scale-110 transition-all disabled:opacity-50">
                  {savingName ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                </button>
                <button onClick={() => setEditingName(false)} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:scale-110 transition-all dark:text-slate-300">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 justify-center">
                <h3 className="text-2xl font-black tracking-tighter font-display">
                  <span className="text-gradient-vibe">{student.name}</span>
                </h3>
                <button
                  onClick={() => { setNewName(student.name); setEditingName(true); }}
                  className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:scale-110 transition-all text-slate-400 dark:text-slate-500 hover:text-vibe-purple"
                  title="Editar nome"
                >
                  <Pencil size={13} />
                </button>
              </div>
            )}
            <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.3em]">{student.grade}ª Série · Turma {student.school_class}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center justify-center gap-2 p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border-2 border-slate-100 dark:border-slate-700 hover:border-vibe-pink dark:hover:border-vibe-cyan hover:scale-105 transition-all cursor-pointer text-[10px] font-black uppercase tracking-widest dark:text-slate-300">
              <Upload size={16} className="text-vibe-cyan" /> Arquivo
              <input type="file" accept="image/*" className="hidden" onChange={e => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                      const canvas = document.createElement('canvas');
                      const maxDim = 512;
                      let width = img.width;
                      let height = img.height;

                      if (width > maxDim || height > maxDim) {
                        if (width > height) {
                          height = (maxDim / width) * height;
                          width = maxDim;
                        } else {
                          width = (maxDim / height) * width;
                          height = maxDim;
                        }
                      }

                      canvas.width = width;
                      canvas.height = height;
                      const ctx = canvas.getContext('2d');
                      ctx?.drawImage(img, 0, 0, width, height);
                      setNewPhoto(canvas.toDataURL('image/jpeg', 0.6));
                    };
                    img.src = event.target?.result as string;
                  };
                  reader.readAsDataURL(file);
                }
              }} />
            </label>
            <button onClick={startCamera} className="flex items-center justify-center gap-2 p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border-2 border-slate-100 dark:border-slate-700 hover:border-vibe-pink dark:hover:border-vibe-cyan hover:scale-105 transition-all text-[10px] font-black uppercase tracking-widest dark:text-slate-300">
              <Camera size={16} className="text-vibe-pink" /> Câmera
            </button>
          </div>

          {newPhoto && (
            <button onClick={handleSave} disabled={loading} className="w-full bg-gradient-vibe text-white p-5 rounded-2xl font-black uppercase text-xs tracking-[0.2em] shadow-glow-purple hover:scale-[1.02] hover:shadow-glow-pink flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50">
              {loading ? <Loader2 className="animate-spin" /> : <Save size={18} />}
              ✨ Salvar Nova Foto
            </button>
          )}
        </div>

        {showCamera && (
          <div className="fixed inset-0 z-[200] bg-slate-950/95 backdrop-blur-2xl flex flex-col items-center justify-center p-4">
            <div className="absolute -top-32 -left-20 w-96 h-96 bg-vibe-pink/40 rounded-full blur-3xl animate-blob"></div>
            <div className="absolute -bottom-32 -right-20 w-96 h-96 bg-vibe-cyan/40 rounded-full blur-3xl animate-blob" style={{ animationDelay: '2s' }}></div>
            <div className="relative w-full max-w-sm aspect-square rounded-[36px] overflow-hidden shadow-2xl ring-4 ring-vibe-purple/40">
              <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
            </div>
            <div className="mt-8 flex gap-4 relative z-10">
              <button onClick={() => setShowCamera(false)} className="bg-white/10 hover:bg-white/20 text-white p-4 rounded-full backdrop-blur-md hover:scale-110 transition-all">
                <X size={24} />
              </button>
              <button onClick={takePhoto} className="bg-gradient-vibe text-white p-6 rounded-full shadow-glow-purple scale-110 hover:scale-125 active:scale-100 transition-all">
                <Camera size={32} />
              </button>
            </div>
            <canvas ref={canvasRef} className="hidden" />
          </div>
        )}
      </div>
    </div>
  );
};
