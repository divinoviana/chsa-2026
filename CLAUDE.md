# Portal CHSA — Ciências Humanas e Sociais Aplicadas

Portal de atividades e avaliações para estudantes do Ensino Médio do Colégio
Estadual Frederico Pedreira Neto (Tocantins). Migrado de Firebase para
Supabase, com IA DeepSeek para correção automática.

**Prof. responsável:** Divino Ribeiro Viana · `+55 (63) 99919-1919`
**Repo:** https://github.com/divinoviana/chsa-2026
**Produção:** https://chsa-2026.vercel.app · https://sistemadeavaliacao.com.br

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + TypeScript + Vite 6 + React Router 7 (HashRouter) |
| Estilo | Tailwind CSS via CDN (`cdn.tailwindcss.com`) + paleta "vibe" custom (gradientes, glows) |
| Backend (BaaS) | Supabase (`roakqjszitzncohzwdpo.supabase.co`) — Auth + Postgres + RLS + Realtime |
| IA | DeepSeek (`api.deepseek.com/v1`, formato OpenAI). Modelo `deepseek-chat`. |
| Hospedagem | Vercel (auto-deploy a partir do `main`) |
| PDF | `jspdf` + `html2canvas` (lazy-loaded) |
| DOCX | `docx` (export de atividades adaptadas) |

---

## Variáveis de ambiente

Configuradas em **Vercel → Settings → Environment Variables** (todos os 3 escopos):

```
API_KEY                 → DeepSeek (formato sk-...)
VITE_SUPABASE_URL       → https://roakqjszitzncohzwdpo.supabase.co
VITE_SUPABASE_ANON_KEY  → sb_publishable_hLFVCVTZm9rwz45ORYRzyw_jV3VD26M
```

Localmente em `.env.local`. `vite.config.ts` injeta `API_KEY` em build-time
como `process.env.API_KEY` + global `__API_KEY__` + `__DEEPSEEK_API_KEY__`,
com fallback pra `VITE_*` e `GEMINI_API_KEY` (legado).

---

## Schema do banco (Supabase Postgres)

Tabelas em `public.*`. RLS ativo em todas. Função `public.is_admin()` reconhece
admins por e-mail (lista hardcoded em `data_admin.ts`) ou `students.role='admin'`.

### Tabelas-chave

| Tabela | Colunas principais | Notas |
|---|---|---|
| `students` | `id` (uuid = `auth.users.id`), `name`, `email`, `school_class`, `grade`, `role` (student/admin), `password` (texto plano, legado), `photo_url` (base64), `created_at` | 376 alunos migrados do banco antigo + 7 admins. `photo_url` é base64 ~1.5 MB. |
| `submissions` | `id` (uuid), `student_id` (FK), `student_name`, `school_class`, `grade`, `lesson_id`, `lesson_title`, `subject`, `content` (jsonb), `ai_feedback` (jsonb), `score`, `teacher_feedback`, `status`, `submitted_at`, `submission_date` | 5.171 entregas. Simulados gravados com `lesson_title` "Avaliação Bimestral: Xº Bimestre" ou customizado. |
| `messages` | `id`, `sender_id` (uuid), `sender_name`, `receiver_id` (uuid), `school_class`, `grade`, `content`, `is_from_teacher` (bool), `subject`, `read_at`, `created_at` | **NÃO tem `student_id` nem `student_name`** (drift de schema vs. código antigo). |
| `student_notes` | `id`, `student_id`, `subject`, `teacher_subject`, `category` (text), `content`, `created_at` | `category ∈ {comportamento, destaque, pedagogico, familiar, saude, geral}`. `teacher_subject` é coluna legada com NOT NULL relaxado. |
| `bimonthly_exams` | `id`, `subject`, `grade`, `bimester`, `title`, `school_class`, `topics` (jsonb), `questions` (jsonb), `visual_content` (jsonb), `created_at` | Simulados criados MANUALMENTE pelo professor. Cada item em `questions` tem `{id, type: 'objective'|'discursive', textFragment, questionText, options?, correctOption?, difficulty, explanation}`. |
| `activities` | `id`, `lesson_id`, `title`, `question_ids` (jsonb), `visual_content` (jsonb), `created_at` | Atividade vinculada a uma `lesson_id` do `curriculumData`. |
| `questions` | `id`, `subject`, `topic`, `lesson_id`, `type`, `difficulty`, `question_text`, `options` (jsonb), `correct_option`, `explanation` | Banco de questões. |
| `lesson_overrides` | `id` (text = lesson_id), `data` (jsonb com `title`, `theory`, `teacher_id`), `updated_at` | Customização do título/teoria de uma aula do `curriculumData`. |
| `teacher_profiles` | `id`, `subject`, `display_name`, `data` (jsonb) | Pouco usado. |
| `activity_submissions`, `activity_answers` | reservadas para fluxo novo de atividades, atualmente vazias. |

### Migrações em `supabase/*.sql`

- **`migration.sql`** — script master idempotente (DDL + RLS + auth backfill). Migra os 376 alunos da tabela `students` (com `password` em texto plano) para `auth.users` via `crypt(password, gen_salt('bf'))`.
- **`admins.sql`** — cria 7 contas admin em `auth.users` (divinoviana, admin, divino.viana, filosofia/geografia/historia/sociologia@frederico.edu.br).
- **`fix_all.sql`** — consolidação dos hotfixes (adiciona colunas faltantes em `bimonthly_exams` e `student_notes`, ativa categoria como coluna separada). **SEMPRE rodar primeiro** em instalações novas.
- **`fix_questions.sql`**, **`fix_exams.sql`** — patches individuais (já cobertos pelo fix_all).

### Padrão "resiliente a schema variante"

`handlePublishExam` e `handleSendMessage` no `AdminDashboard` usam um padrão
genérico: tentam INSERT, se o Postgres retornar `Could not find the 'X' column`,
removem `X` do payload e refazem o insert (até 4-6 tentativas). Isso permite
o app funcionar mesmo se o SQL de fix não tiver sido rodado ainda.

---

## Autenticação

- Login email/senha: `supabase.auth.signInWithPassword()`
- Login Google: `supabase.auth.signInWithOAuth({ provider: 'google' })`
- Reset de senha: **só pelo aluno** via "🔑 Esqueceu a senha?" no `/login`. O professor **não** tem botão pra resetar (removido por causar erros).
- AuthContext lê `students` SEM `photo_url` (busca foto separada em background) — evita login lento.
- `StudentRoute` redireciona pra `/login` quando aluno autenticado tem perfil incompleto (sem `grade`/`school_class`). Admins (lista de e-mails) passam direto.

---

## Telas e fluxos

### Aluno

| Rota | Tela | Função |
|---|---|---|
| `/login` | `Login.tsx` | Email+senha + Google OAuth + reset de senha. Após login Google sem perfil, abre formulário "Completar Perfil" (escolhe série + turma → upsert em `students`). |
| `/` | `Home.tsx` | Saudação, Avaliações Pendentes (simulados), 4 cards de matérias com contagem de atividades publicadas. |
| `/grade/:id?subject=X` | `GradeView.tsx` | Lista de aulas por bimestre. **Só mostra aulas com `activities` row + `questions`** (caso contrário aluno não vê). |
| `/lesson/:lessonId` | `LessonView.tsx` | Teoria (do `lesson_overrides`) + questões (objetivas e discursivas) do banco. |
| `/evaluation/:examId` | `EvaluationView.tsx` | Simulado bimestral. Suporta questões objetivas (A-E) + discursivas (textarea). |
| `/contact` | `Contact.tsx` | Chat aluno↔professor por matéria. Realtime via channel `supabase`. |
| `/my-activities` | `MyActivities.tsx` | Histórico de submissões com feedback da IA + nota. |
| `/profile` | `Profile.tsx` | Trocar foto (câmera ou upload, redimensiona pra 512px @ 60% qualidade). |
| `/atividades-adaptadas` | `AdaptedActivities.tsx` | **Rota pública** (sem login) — professor gera atividades adaptadas para alunos neurodivergentes. Exporta PDF/DOCX. CSS de impressão tem `@media print` em `index.html` + classe `.export-mode` que neutraliza cores escuras. |

### Admin (`/admin`)

Sidebar com 8 abas. Login com `loginTeacher(subject)` define `teacherSubject` que filtra dados por matéria. Super admins (`divinoviana@gmail.com`, `admin@admin.com`) veem tudo.

| Aba | Função |
|---|---|
| Plano de Aulas | Edita títulos/teoria das aulas (`lesson_overrides`) + abre editor de atividade (`activities` + `questions`). |
| Banco de Temas | CRUD de questões. |
| Submissões | Tabela de entregas com filtros. Modal pra dar feedback ao aluno. |
| Notas | Carômetro com agregação por bimestre. Inclui **todos** os alunos da turma/série (mesmo sem submissão). Simulados destacados com badge laranja. |
| Estudantes | Carômetro completo (376 alunos). **2 botões por card**: ✏️ Anotações + 💬 Mensagem. Clicar na foto também abre Anotações. |
| Mensagens | Lista de conversas + chat com realtime channel. |
| Simulados | Editor **manual** de simulado (título, tópicos, série, bimestre, turma) + adicionador de questões objetivas/discursivas. Botão opcional "Sugerir com IA". |
| Relatórios IA | DeepSeek cruza notas + `teacher_feedback` + `student_notes` (com categoria) + atividades por bimestre. Gera markdown com plano de intervenção. |

### Anotações comportamentais (`student_notes`)

5 categorias coloridas + emoji: 🟡 Comportamento · 🟢 Destaque · 🔵 Pedagógico · 🟣 Familiar · 🔴 Saúde. Aluno clica na foto OU no botão lápis pra abrir o modal. Cada categoria tem seu próprio histórico.

---

## IA — `services/aiService.ts` (DeepSeek)

| Função | Quando dispara | Estratégia |
|---|---|---|
| `evaluateActivities()` | Aluno envia atividade | **Híbrida**: objetivas corrigidas em JS local (matching de letra A-E), discursivas via IA. Se IA cair, fallback: ≥30 chars → 6/10. NUNCA dá 0 indevido. |
| `generateBimonthlyEvaluation()` | Admin pede "sugerir questões IA" no editor de simulado | JSON estrito com 5 questões. |
| `generatePedagogicalSummary()` | Admin → Relatórios IA | Cruza notas + comportamento + atividades. Saída em markdown. |
| `generateLessonActivity()`, `generateLessonPlan()` | Legado, raramente usado |  |
| `generateActivityImage()` | Stub (DeepSeek não gera imagem) |  |

`getApiKey()` busca em 4 caminhos: `__API_KEY__` (global injetada), `process.env.*`, `import.meta.env.VITE_*`, `window.__APP_CONFIG__`. Falha graciosa com mensagem clara se nenhum tiver chave.

---

## Performance

Bundle inicial cai pra ~14 KB com:

- **React.lazy** em todas as 9 telas (Suspense fallback simples)
- **vite manualChunks** segmenta: `vendor-react`, `vendor-router`, `vendor-supabase`, `vendor-pdf`, `vendor-charts`, `vendor-icons`, `data-curriculum` (355 KB do currículo só carrega em /grade ou /lesson), `data-seed`, `data-meta`, `AdminDashboard` (90 KB só em /admin).
- **AuthContext** não busca `photo_url` no login (busca em background).
- **`StudentAvatar`** usa **IntersectionObserver + batch + cache global** — 376 cards do carômetro fazem 1-3 requests batchados em vez de 376 paralelos.

---

## Decisões de design tomadas (e por quê)

1. **Senhas em texto plano em `students.password`** — herdadas do banco anterior. Migradas pra `auth.users` com bcrypt via `crypt()` no `migration.sql`. A coluna ainda existe; pode ser dropada depois que confirmar que todos os alunos logam.
2. **`role` admin via e-mail hardcoded + RLS** — não via Supabase Auth Roles, porque ainda não justifica a complexidade. Lista está em `data_admin.ts` e na função `public.is_admin()` no banco.
3. **HashRouter, não BrowserRouter** — Vercel mais simples sem rewrites e o redirect OAuth do Supabase fica compatível.
4. **Tailwind via CDN, não bundled** — escolha legado. Migrar pra instalação local exigiria reescrita do build mas reduziria ~3 MB do download inicial.
5. **DeepSeek e não Gemini** — Gemini tinha conta gratuita, mas usuário trocou pra DeepSeek (que é OpenAI-compatible, mais barato — ~$0.27/M tokens input). API key chama `API_KEY` (sem prefixo VITE) e é injetada em build-time pelo `vite.config.ts`.
6. **Tela admin sem botão "Excluir aluno"** — fluxo removido porque (a) reset de senha causava erros e o aluno faz sozinho via "Esqueceu a senha?", (b) exclusão é operação rara, faz pelo Supabase Dashboard direto.
7. **Visual Gen Alpha** — paleta `vibe-*` em `index.html` + gradientes (`gradient-vibe`, `gradient-cosmic`, etc) + glows e blobs animados. Todas as telas usam.
8. **ErrorBoundary global** em `App.tsx` — mostra card amigável "Algo deu errado" + botões Retry/Reload em vez de tela branca. Logs no console.

---

## Gotchas / armadilhas conhecidas

- **`SELECT *` em `students`** pesa 580 MB (376 alunos × 1.5 MB de photo_url base64). SEMPRE seleciona colunas específicas, sem `photo_url`, ou usa o batch helper.
- **Schema drift** em `messages` (sem `student_id`/`student_name`) e `bimonthly_exams` (faltava `title`/`school_class`/`topics`/`visual_content` em instalações antigas). Handlers usam padrão tolerante (retry sem coluna que faltou).
- **Tailwind CDN JIT** às vezes não compila classes custom em tempo. Em modais críticos (Settings, antes de remover) usar CSS inline (`style={{ background: 'linear-gradient(...)' }}`) em vez de `bg-gradient-cosmic`.
- **Vercel deployment-preview URLs** (`chsa-2026-<hash>-divino-vianas-projects.vercel.app`) podem ter sido buildados antes das env vars serem adicionadas. A URL canônica `chsa-2026.vercel.app` sempre tem o último build de produção.
- **Cache do navegador** — quando muda algo pequeno e o usuário ainda vê erro antigo, pedir **hard refresh (Ctrl+Shift+R)** antes de investigar mais.

---

## Comandos comuns

```bash
npm run dev        # vite, porta 5173
npm run build      # produção em dist/
npm run lint       # tsc --noEmit
npm install        # depois de mexer no package.json
```

Git remoto: `origin → divinoviana/chsa-2026`. Push direto pro `main` faz auto-deploy na Vercel.

---

## Histórico recente (commits importantes)

- `a157f2f` — Remove engrenagem de Settings do card de aluno (estava causando "Illegal constructor")
- `97c65e3` — Footer: contato fixo (sem link) com telefone do prof
- `d225e60`/`0361e09`/`fbe86ed` — Visual refresh Gen Alpha em todas as telas (paleta vibe, gradientes, glows, mesh-bg, animações)
- `8d928ae` — Code-splitting agressivo (bundle de 2 MB → 14 KB inicial)
- `bec4493` — Força aluno Google a completar perfil (série + turma)
- `0db57df` — Tolerância a schema variante em `bimonthly_exams`
- `d2b4952` — Migra IA de Gemini pra DeepSeek
- `bf9b32d` — Commit inicial: migração de Firebase pra Supabase

---

## Próximos passos sugeridos (se o usuário pedir)

- Dropar `students.password` agora que todos migraram pra `auth.users`
- Migrar Tailwind CDN → instalação local (Vite plugin) pra reduzir ~3 MB
- Adicionar Edge Function pra reset administrativo via service_role
- Adicionar revisão manual do professor sobre as notas da IA
- Push notifications (PWA) quando o prof publicar atividade
