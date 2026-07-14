
import React, { Suspense, lazy, ReactNode } from 'react';
import { HashRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { Header } from './components/Header';
import { TEACHER_INFO, TEACHER_EMAILS } from './data_admin';
import { Mail, Lock } from 'lucide-react';

// Telas carregadas sob demanda — chunks separados para a primeira tela
// (Home + Login) carregar rapidamente. Cada rota baixa só seu pedaço.
const Login          = lazy(() => import('./screens/Login').then(m => ({ default: m.Login })));
const Home           = lazy(() => import('./screens/Home').then(m => ({ default: m.Home })));
const GradeView      = lazy(() => import('./screens/GradeView').then(m => ({ default: m.GradeView })));
const LessonView     = lazy(() => import('./screens/LessonView').then(m => ({ default: m.LessonView })));
const Contact        = lazy(() => import('./screens/Contact').then(m => ({ default: m.Contact })));
const AdminDashboard = lazy(() => import('./screens/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const MyActivities   = lazy(() => import('./screens/MyActivities').then(m => ({ default: m.MyActivities })));
const EvaluationView = lazy(() => import('./screens/EvaluationView').then(m => ({ default: m.EvaluationView })));
const Profile        = lazy(() => import('./screens/Profile').then(m => ({ default: m.Profile })));
const AdaptedActivities = lazy(() => import('./screens/AdaptedActivities').then(m => ({ default: m.AdaptedActivities })));
const CognitiveAssessment = lazy(() => import('./screens/CognitiveAssessment').then(m => ({ default: m.CognitiveAssessment })));

// Spinner padrão enquanto a tela carrega
const RouteFallback = () => (
  <div className="h-[60vh] flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-tocantins-blue rounded-full animate-spin"></div>
  </div>
);

// Error Boundary global — evita que um erro de render numa tela
// deixe o app inteiro em branco. Mostra uma mensagem amigável e
// um botão pra tentar de novo.
// Error Boundary global — class component. O `// @ts-ignore` em volta
// das ocorrências de this.state/this.props/this.setState é necessário
// devido a um bug de inferência de tipo no tsconfig atual (sem strict).
// Em runtime, a classe estende React.Component normalmente.
interface ErrorBoundaryProps { children: ReactNode }
interface ErrorBoundaryState { hasError: boolean; error?: Error }
// @ts-ignore - bug de inferência sem strict mode
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    // @ts-ignore
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: any) {
    console.error('[ErrorBoundary]', error, info);
  }
  render() {
    // @ts-ignore
    const { hasError, error } = this.state || {};
    if (hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-slate-950 text-white">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center">
            <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-3xl"
                 style={{ background: 'linear-gradient(135deg, #FF3D8A 0%, #8B5CF6 100%)' }}>⚠️</div>
            <h2 className="text-xl font-black mb-2">Algo deu errado</h2>
            <p className="text-slate-400 text-sm mb-6 break-words">
              {error?.message || 'Erro desconhecido no aplicativo.'}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                // @ts-ignore
                onClick={() => this.setState({ hasError: false, error: undefined })}
                className="px-5 py-3 rounded-xl text-white text-xs font-black uppercase tracking-widest"
                style={{ background: 'linear-gradient(135deg, #FF3D8A 0%, #8B5CF6 100%)' }}
              >
                Tentar Novamente
              </button>
              <button
                onClick={() => { window.location.hash = '#/'; window.location.reload(); }}
                className="px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-black uppercase tracking-widest"
              >
                Recarregar App
              </button>
            </div>
          </div>
        </div>
      );
    }
    // @ts-ignore
    return this.props.children;
  }
}

const StudentRoute = ({ children }: { children?: React.ReactNode }) => {
  const { student, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-tocantins-blue rounded-full animate-spin"></div>
      </div>
    );
  }
  if (!student) return <Navigate to="/login" replace />;

  // Aluno autenticado mas SEM perfil completo (típico do 1º login Google):
  // manda para /login para o formulário de "Completar Perfil" (turma + série).
  const adminEmails = ['admin@admin.com', 'divinoviana@gmail.com', ...Object.values(TEACHER_EMAILS)];
  const isAdminEmail = adminEmails.includes(String(student.email || '').toLowerCase());
  const profileIncomplete = !student.grade || !student.school_class || student.grade === 'N/A' || student.school_class === 'N/A';
  if (profileIncomplete && !isAdminEmail) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

function AppContent() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col font-sans transition-colors duration-300">
      <Header />
      <main className="flex-grow">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/admin/login" element={<Login adminMode={true} />} />
            <Route path="/" element={<StudentRoute><Home /></StudentRoute>} />
            <Route path="/grade/:id" element={<StudentRoute><GradeView /></StudentRoute>} />
            <Route path="/lesson/:lessonId" element={<StudentRoute><LessonView /></StudentRoute>} />
            <Route path="/evaluation/:examId" element={<StudentRoute><EvaluationView /></StudentRoute>} />
            <Route path="/contact" element={<StudentRoute><Contact /></StudentRoute>} />
            <Route path="/my-activities" element={<StudentRoute><MyActivities /></StudentRoute>} />
            <Route path="/profile" element={<StudentRoute><Profile /></StudentRoute>} />
            <Route path="/admin" element={<AdminDashboard />} />
            {/* Rota PÚBLICA — atividades adaptadas para neurodivergentes.
                Sem login: o professor acessa direto pelo link e gera atividade. */}
            <Route path="/atividades-adaptadas" element={<AdaptedActivities />} />
            {/* Rota PÚBLICA — avaliação cognitiva (triagem QI/superdotação/
                neurodivergência). Pode ser feita anônima, sem login. */}
            <Route path="/avaliacao-cognitiva" element={<CognitiveAssessment />} />
          </Routes>
        </Suspense>
      </main>
      <footer className="bg-slate-900 text-slate-400 py-12">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center text-center md:text-left border-b border-slate-800 pb-8 mb-8">
            <div>
              <h4 className="text-white font-bold mb-2">Portal de Ciências Humanas</h4>
              <p className="text-sm">Conectando o conhecimento à realidade juvenil do Tocantins.</p>
            </div>
            
            <div className="flex flex-col md:items-end gap-3">
              <div className="inline-flex flex-col md:items-end gap-1 px-5 py-3 bg-slate-800 rounded-2xl">
                <span className="inline-flex items-center gap-2 text-tocantins-yellow text-sm font-bold">
                  <Mail className="w-4 h-4" /> Contato
                </span>
                <span className="text-white text-sm font-mono tracking-wide">+55 (63) 99919-1919</span>
                <span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">Prof. Divino Viana</span>
              </div>
              <div className="flex flex-col md:items-end gap-2">
                <Link to="/avaliacao-cognitiva" className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 rounded-xl text-cyan-300 text-xs font-bold hover:text-white hover:scale-105 transition">
                  🧠 Avaliação Cognitiva
                </Link>
                <Link to="/admin" className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 rounded-xl text-white/60 hover:text-white transition-colors text-xs">
                  <Lock className="w-3 h-3" /> Painel Admin
                </Link>
              </div>
            </div>
          </div>
          <div className="text-center text-xs space-y-2 opacity-80">
            <p>© 2026 {TEACHER_INFO.department} - Tocantins</p>
            <p>{TEACHER_INFO.role}: <a href="http://lattes.cnpq.br/7639474934278364" target="_blank" rel="noopener noreferrer" className="text-slate-100 font-black hover:text-tocantins-yellow transition-all underline decoration-slate-700 underline-offset-4 decoration-2">{TEACHER_INFO.name}</a></p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <Router>
            <AppContent />
          </Router>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
