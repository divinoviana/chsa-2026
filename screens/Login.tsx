
import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, Loader2, User, Lock, Camera, Upload, X, Check, Chrome, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

import { TEACHER_EMAILS, ADMIN_PASSWORDS } from '../data_admin';
import { Subject } from '../types';

export const Login: React.FC<{ adminMode?: boolean }> = ({ adminMode = false }) => {
  const { student, loginStudent, loginTeacher } = useAuth();
  const [isRegistering, setIsRegistering] = useState(false);
  const [isAdminLogin, setIsAdminLogin] = useState(adminMode);
  const [loading, setLoading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const navigate = useNavigate();

  const [photo, setPhoto] = useState<string | null>(null);
  const [googleUserPending, setGoogleUserPending] = useState<any>(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleResetPassword = async () => {
    if (!formData.email) {
      alert("Por favor, digite seu e-mail para solicitar a redefinição de senha.");
      return;
    }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(formData.email, {
        redirectTo: window.location.origin
      });
      if (error) throw error;
      alert("Um link de redefinição de senha foi enviado para o seu e-mail. Verifique também a pasta de spam.");
    } catch (err: any) {
      alert("Erro ao enviar redefinição: " + err.message);
    }
  };

  // Redirect só quando perfil está realmente completo (grade + turma).
  // Mantém na tela de login enquanto aluno Google não escolheu série/turma.
  React.useEffect(() => {
    if (
      student &&
      !googleUserPending &&
      student.grade &&
      student.school_class &&
      student.grade !== 'N/A' &&
      student.school_class !== 'N/A' &&
      !isAdminLogin
    ) {
      navigate('/');
    }
  }, [student, googleUserPending, navigate, isAdminLogin]);

  const [adminData, setAdminData] = useState({
    email: '',
    password: ''
  });
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    school_class: '',
    grade: '1'
  });

  const handleAdminAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Super admin
      if ((adminData.email === 'admin@admin.com' || adminData.email === 'divinoviana@gmail.com') && adminData.password === 'admin123') {
        const { error } = await supabase.auth.signInWithPassword({
          email: adminData.email,
          password: adminData.password,
        });
        if (error) throw error;
        loginTeacher('filosofia' as Subject);
        navigate('/admin');
        return;
      }

      // Match por matéria
      let foundSubject: Subject | null = null;
      Object.entries(TEACHER_EMAILS).forEach(([subject, email]) => {
        if (email === adminData.email) {
          foundSubject = subject as Subject;
        }
      });

      if (foundSubject && ADMIN_PASSWORDS[foundSubject] === adminData.password) {
        const { error } = await supabase.auth.signInWithPassword({
          email: adminData.email,
          password: adminData.password,
        });
        if (error) throw error;
        loginTeacher(foundSubject);
        navigate('/admin');
      } else {
        alert("Credenciais de administrador inválidas.");
      }
    } catch (err: any) {
      console.error("Admin Auth Error:", err);
      alert("Erro ao acessar área docente: " + (err.message || "Verifique suas credenciais."));
    } finally {
      setLoading(false);
    }
  };
  
  const startCamera = async () => {
    setShowCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      alert("Não foi possível acessar a câmera.");
      setShowCamera(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
    setShowCamera(false);
  };

  const takePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg');
      setPhoto(dataUrl);
      stopCamera();
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      // OAuth via Supabase. Voltamos para a raiz do app — o StudentRoute em
      // App.tsx redireciona pra /login automaticamente quando o aluno Google
      // ainda não escolheu série e turma (perfil incompleto).
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (err: any) {
      console.error("Google Login Error:", err);
      alert("Erro no acesso com Google: " + (err.message || "Erro desconhecido"));
    } finally {
      setLoading(false);
    }
  };

  // Após retorno do OAuth: se o usuário Google ainda não tem registro em
  // `students` (ou está com perfil incompleto), abrimos o fluxo de
  // "completar perfil" (turma + série).
  React.useEffect(() => {
    if (isAdminLogin) return; // tela admin não trata aluno aqui
    if (!student?.id) return;
    if (googleUserPending) return; // já está em fluxo

    const profileComplete =
      student.school_class &&
      student.grade &&
      student.school_class !== 'N/A' &&
      student.grade !== 'N/A';
    if (profileComplete) return;

    // Detectar admin via email (não precisa criar student)
    const adminEmails = ['admin@admin.com', 'divinoviana@gmail.com', ...Object.values(TEACHER_EMAILS)];
    if (adminEmails.includes(String(student.email || '').toLowerCase())) return;

    // Pendente de completar perfil
    setGoogleUserPending({
      id: student.id,
      displayName: student.name,
      email: student.email,
      photoURL: student.photo_url,
    });
  }, [student, googleUserPending, isAdminLogin]);

  const handleCompleteGoogleRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!googleUserPending || !formData.school_class) return;
    setLoading(true);
    try {
      const studentData = {
        id: googleUserPending.id,
        name: googleUserPending.displayName || 'Aluno',
        email: googleUserPending.email,
        grade: formData.grade,
        school_class: formData.school_class,
        photo_url: googleUserPending.photoURL || null,
        role: 'student' as const,
      };

      const { error } = await supabase.from('students').upsert(studentData, { onConflict: 'id' });

      if (error) {
        // Email já existe com outro ID (registro legado sem auth.users correspondente).
        // Nesse caso o admin precisa executar a migração no banco.
        if (error.message?.toLowerCase().includes('unique') || error.code === '23505') {
          alert(
            `⚠️ Seu e-mail (${googleUserPending.email}) já está cadastrado no sistema com outro ID.\n\n` +
            `Entre em contato com seu professor para que ele corrija seu cadastro.\n\n` +
            `Informe ao professor: migração de conta Google necessária para "${googleUserPending.displayName}".`
          );
          return;
        }
        throw error;
      }

      loginStudent(studentData);
      setGoogleUserPending(null);
      navigate('/');
    } catch (err: any) {
      console.error("Complete registration error:", err);
      alert("Erro ao concluir cadastro: " + (err.message || "Tente novamente."));
    } finally {
      setLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isRegistering) {
        if (!photo) throw new Error("A foto é obrigatória para o cadastro.");

        // 1) Criar usuário no Supabase Auth
        const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
          email: formData.email,
          password: formData.password,
          options: {
            data: { name: formData.name },
          },
        });
        if (signUpErr) throw signUpErr;
        const user = signUpData.user;
        if (!user) throw new Error("Falha ao criar conta.");

        // 2) Inserir profile em `students`
        const studentData = {
          id: user.id,
          name: formData.name,
          email: formData.email,
          school_class: formData.school_class,
          grade: formData.grade,
          photo_url: photo,
          role: 'student' as const,
        };
        const { error: insertErr } = await supabase.from('students').upsert(studentData, { onConflict: 'id' });
        if (insertErr) throw insertErr;

        loginStudent(studentData);

        alert("Cadastro realizado com sucesso!");
        navigate('/');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: formData.email,
          password: formData.password,
        });
        if (error) throw error;
        navigate('/');
      }
    } catch (err: any) {
      console.error("Auth error:", err);
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('invalid login') || msg.includes('invalid credentials')) {
        alert("E-mail ou senha incorretos. Verifique seus dados ou use 'Esqueceu a senha?'.");
      } else if (msg.includes('already registered') || msg.includes('user already')) {
        alert("Este e-mail já está em uso. Se você já tem uma conta, faça login.");
      } else {
        alert(err.message || "Ocorreu um erro no acesso.");
      }
    } finally {
      setLoading(false);
    }
  };

  const getClassesByGrade = (grade: string) => {
    if (grade === '1') return Array.from({length: 7}, (_, i) => `13.0${i+1}`);
    if (grade === '2') return Array.from({length: 8}, (_, i) => `23.0${i+1}`);
    if (grade === '3') return Array.from({length: 9}, (_, i) => `33.0${i+1}`);
    return [];
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 font-sans relative overflow-hidden bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
      {/* Mesh gradient + blobs animados */}
      <div className="absolute inset-0 bg-mesh-bg opacity-100 dark:opacity-30 pointer-events-none"></div>
      <div className="absolute -top-32 -left-20 w-96 h-96 bg-vibe-pink/30 rounded-full blur-3xl animate-blob"></div>
      <div className="absolute top-40 -right-24 w-96 h-96 bg-vibe-purple/30 rounded-full blur-3xl animate-blob" style={{ animationDelay: '2s' }}></div>
      <div className="absolute -bottom-32 left-1/3 w-[28rem] h-[28rem] bg-vibe-cyan/30 rounded-full blur-3xl animate-blob" style={{ animationDelay: '4s' }}></div>

      <div className="relative bg-white/90 dark:bg-slate-900/90 backdrop-blur-2xl p-8 rounded-[40px] shadow-2xl w-full max-w-md border border-white/50 dark:border-slate-800/50 transition-colors duration-300 z-10">
        <div className="text-center mb-8">
          <div className="bg-gradient-vibe w-20 h-20 rounded-[28px] flex items-center justify-center mx-auto mb-5 shadow-glow-purple animate-float">
            <GraduationCap className="w-12 h-12 text-white drop-shadow-lg" strokeWidth={2.5} />
          </div>
          <h2 className="text-3xl font-black uppercase tracking-tighter font-display">
            <span className="text-gradient-vibe">
              {googleUserPending ? 'Completar Perfil' : isAdminLogin ? 'Área Docente' : isRegistering ? 'Novo Cadastro' : 'Portal do Aluno'}
            </span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-[10px] font-black uppercase tracking-[0.3em] mt-2">✨ Ciências Humanas · Tocantins</p>
        </div>

        {googleUserPending ? (
          <form onSubmit={handleCompleteGoogleRegistration} className="space-y-6">
            <div className="text-center mb-6">
              <img src={googleUserPending.photoURL} className="w-20 h-20 rounded-full mx-auto mb-3 border-4 border-tocantins-blue dark:border-tocantins-yellow shadow-lg" alt="Google Profile" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Olá, {googleUserPending.displayName}!</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black tracking-widest mt-1">Selecione sua turma para continuar</p>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
                <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 border dark:border-slate-700 rounded-2xl text-sm outline-none dark:text-white transition-colors" value={formData.grade} onChange={e => setFormData({...formData, grade: e.target.value})}>
                  <option value="1">1ª Série</option>
                  <option value="2">2ª Série</option>
                  <option value="3">3ª Série</option>
                </select>
                <select required className="w-full p-4 bg-slate-50 dark:bg-slate-800 border dark:border-slate-700 rounded-2xl text-sm outline-none dark:text-white transition-colors" value={formData.school_class} onChange={e => setFormData({...formData, school_class: e.target.value})}>
                  <option value="">Turma</option>
                  {getClassesByGrade(formData.grade).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>

            <button disabled={loading} className="w-full bg-gradient-vibe text-white p-5 rounded-2xl font-black uppercase text-xs tracking-[0.2em] shadow-glow-purple flex justify-center items-center gap-2 cursor-pointer active:scale-95 hover:scale-[1.02] hover:shadow-glow-pink transition-all disabled:opacity-50">
              {loading ? <Loader2 className="animate-spin" /> : '✨ Concluir Cadastro'}
            </button>
            
            <button type="button" onClick={() => setGoogleUserPending(null)} className="w-full text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-4 hover:text-red-500 transition-colors">
              Cancelar e voltar
            </button>
          </form>
        ) : isAdminLogin ? (
          <form onSubmit={handleAdminAuth} className="space-y-4">
             <div className="space-y-3">
                <div className="relative">
                  <input required type="email" placeholder="E-mail do Professor" className="w-full p-4 pl-12 bg-slate-50 dark:bg-slate-800 dark:text-white border dark:border-slate-700 rounded-2xl text-sm outline-none focus:ring-1 focus:ring-tocantins-blue transition-colors" value={adminData.email} onChange={e => setAdminData({...adminData, email: e.target.value})} />
                  <User className="absolute left-4 top-4 text-slate-300 dark:text-slate-600" size={18} />
                </div>
                <div className="relative">
                  <input required type={showPassword ? "text" : "password"} placeholder="Senha de Acesso" className="w-full p-4 pl-12 pr-12 bg-slate-50 dark:bg-slate-800 dark:text-white border dark:border-slate-700 rounded-2xl text-sm outline-none focus:ring-1 focus:ring-tocantins-blue transition-colors" value={adminData.password} onChange={e => setAdminData({...adminData, password: e.target.value})} />
                  <Lock className="absolute left-4 top-4 text-slate-300 dark:text-slate-600" size={18} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-4 text-slate-400 hover:text-tocantins-blue transition-colors">
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button disabled={loading} className="w-full bg-gradient-cosmic text-white p-5 rounded-2xl font-black uppercase text-xs tracking-[0.2em] shadow-glow-purple flex justify-center items-center gap-2 cursor-pointer active:scale-95 hover:scale-[1.02] transition-all disabled:opacity-50">
                {loading ? <Loader2 className="animate-spin" /> : '🔐 Acessar Painel'}
              </button>

              <div className="mt-8 text-center border-t dark:border-slate-800 pt-6">
                <button type="button" onClick={() => setIsAdminLogin(false)} className="text-[10px] font-black text-slate-400 dark:text-slate-500 hover:text-tocantins-blue dark:hover:text-tocantins-yellow uppercase tracking-widest transition-colors cursor-pointer">
                  Voltar para Portal do Aluno
                </button>
              </div>
          </form>
        ) : (
          <>
            <div className="mb-6">
              <button 
                type="button"
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 p-4 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all active:scale-95"
              >
                <Chrome className="w-5 h-5 text-tocantins-blue dark:text-tocantins-yellow" />
                Entrar com Google
              </button>
              
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-100 dark:border-slate-800"></div></div>
                <div className="relative flex justify-center text-[10px] uppercase font-black text-slate-300 dark:text-slate-600"><span className="bg-white dark:bg-slate-900 px-4 transition-colors">ou use seu e-mail</span></div>
              </div>
            </div>

            <form onSubmit={handleAuth} className="space-y-4">
              {isRegistering && (
                 <div className="space-y-3">
                    <input required placeholder="Nome Completo" className="w-full p-4 bg-slate-50 dark:bg-slate-800 dark:text-white border dark:border-slate-700 rounded-2xl text-sm outline-none focus:ring-1 focus:ring-tocantins-blue transition-colors" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                    <div className="grid grid-cols-2 gap-3">
                        <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 dark:text-white border dark:border-slate-700 rounded-2xl text-sm outline-none transition-colors" value={formData.grade} onChange={e => setFormData({...formData, grade: e.target.value})}>
                          <option value="1">1ª Série</option>
                          <option value="2">2ª Série</option>
                          <option value="3">3ª Série</option>
                        </select>
                        <select required className="w-full p-4 bg-slate-50 dark:bg-slate-800 dark:text-white border dark:border-slate-700 rounded-2xl text-sm outline-none transition-colors" value={formData.school_class} onChange={e => setFormData({...formData, school_class: e.target.value})}>
                          <option value="">Turma</option>
                          {getClassesByGrade(formData.grade).map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>

                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <label className="flex-1 flex items-center justify-center gap-2 p-3 bg-slate-50 dark:bg-slate-800 rounded-2xl border-dashed border-2 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase">
                          <Upload size={16} /> Arquivo
                          <input type="file" accept="image/*" className="hidden" onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onloadend = () => setPhoto(reader.result as string);
                              reader.readAsDataURL(file);
                            }
                          }} />
                        </label>
                        <button type="button" onClick={startCamera} className="flex-1 flex items-center justify-center gap-2 p-3 bg-slate-50 dark:bg-slate-800 rounded-2xl border-dashed border-2 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase">
                          <Camera size={16} /> Câmera
                        </button>
                      </div>
                      
                      {photo && !showCamera && (
                        <div className="relative w-20 h-20 mx-auto group">
                          <img src={photo} className="w-full h-full object-cover rounded-2xl border-2 border-tocantins-blue dark:border-tocantins-yellow" />
                          <button type="button" onClick={() => setPhoto(null)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-lg">
                            <X size={12} />
                          </button>
                        </div>
                      )}
                    </div>

                    {showCamera && (
                      <div className="fixed inset-0 z-[200] bg-slate-900 flex flex-col items-center justify-center p-4">
                        <div className="relative w-full max-w-sm aspect-square bg-black rounded-3xl overflow-hidden shadow-2xl border-4 border-white/10">
                          <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                          <canvas ref={canvasRef} className="hidden" />
                        </div>
                        <div className="mt-8 flex gap-4">
                          <button type="button" onClick={stopCamera} className="bg-white/10 text-white p-4 rounded-full hover:bg-white/20">
                            <X size={24} />
                          </button>
                          <button type="button" onClick={takePhoto} className="bg-tocantins-blue text-white p-6 rounded-full shadow-2xl scale-110 active:scale-95 transition-transform">
                            <Camera size={32} />
                          </button>
                        </div>
                        <p className="text-white/50 text-[10px] font-black uppercase mt-6 tracking-widest">Aponte para seu rosto</p>
                      </div>
                    )}
                 </div>
              )}

              <div className="space-y-3">
                <div className="relative">
                  <input required type="email" placeholder="E-mail" className="w-full p-4 pl-12 bg-slate-50 dark:bg-slate-800 dark:text-white border dark:border-slate-700 rounded-2xl text-sm outline-none focus:ring-1 focus:ring-tocantins-blue transition-colors" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                  <User className="absolute left-4 top-4 text-slate-300 dark:text-slate-600" size={18} />
                </div>
                <div className="relative">
                  <input required type={showPassword ? "text" : "password"} placeholder="Senha" className="w-full p-4 pl-12 pr-12 bg-slate-50 dark:bg-slate-800 dark:text-white border dark:border-slate-700 rounded-2xl text-sm outline-none focus:ring-1 focus:ring-tocantins-blue transition-colors" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
                  <Lock className="absolute left-4 top-4 text-slate-300 dark:text-slate-600" size={18} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-4 text-slate-400 hover:text-tocantins-blue transition-colors">
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {!isRegistering && (
                  <div className="flex justify-end px-1">
                    <button
                      type="button"
                      onClick={handleResetPassword}
                      className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full text-vibe-purple hover:text-white hover:bg-gradient-vibe transition-all hover:scale-105"
                    >
                      🔑 Esqueceu a senha?
                    </button>
                  </div>
                )}
              </div>

              <button disabled={loading} className="w-full bg-gradient-vibe text-white p-5 rounded-2xl font-black uppercase text-xs tracking-[0.2em] shadow-glow-purple flex justify-center items-center gap-2 cursor-pointer active:scale-95 hover:scale-[1.02] hover:shadow-glow-pink transition-all disabled:opacity-50">
                {loading ? <Loader2 className="animate-spin" /> : isRegistering ? '🚀 Criar Minha Conta' : '✨ Entrar no Portal'}
              </button>
            </form>

            <div className="mt-8 text-center border-t dark:border-slate-800 pt-6 flex flex-col gap-4">
              <button onClick={() => setIsRegistering(!isRegistering)} className="text-[10px] font-black text-slate-400 dark:text-slate-500 hover:text-tocantins-blue dark:hover:text-tocantins-yellow uppercase tracking-widest transition-colors cursor-pointer">
                {isRegistering ? 'Já tenho uma conta? Fazer Login' : 'Não tem conta? Registre-se aqui'}
              </button>
              
              {!isRegistering && (
                <button onClick={() => setIsAdminLogin(true)} className="text-[10px] font-black text-tocantins-blue dark:text-tocantins-yellow opacity-60 hover:opacity-100 uppercase tracking-widest transition-colors cursor-pointer flex items-center justify-center gap-2">
                  <Lock size={12} /> ÁREA DO PROFESSOR
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
