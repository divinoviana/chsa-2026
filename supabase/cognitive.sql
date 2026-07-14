-- =====================================================================
-- Avaliação Cognitiva CHSA — triagem QI / superdotação / neurodivergência
-- Idempotente: pode rodar mais de uma vez sem quebrar.
-- =====================================================================

create table if not exists public.cognitive_assessments (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid references public.students(id),
  student_name     text,
  anon_code        text,
  is_anonymous     boolean default false,
  age              int,
  grade            text,
  school_class     text,
  icg              int,            -- Índice Cognitivo Geral (M=100, DP=15)
  percentile       numeric,
  classification   text,           -- Muito Superior / Superior / Média...
  domain_scores    jsonb,          -- [{key, z, index, percentile}] por domínio CHC
  giftedness       jsonb,          -- resultado Renzulli (3 anéis + nível)
  screenings       jsonb,          -- TDAH/TEA/Dislexia com graus
  integrity        jsonb,          -- tab switches, respostas rápidas, validade
  duration_seconds int,
  created_at       timestamptz default now()
);

alter table public.cognitive_assessments enable row level security;

-- INSERT liberado para anon + authenticated (modo anônimo funciona sem login)
drop policy if exists cognitive_insert on public.cognitive_assessments;
create policy cognitive_insert on public.cognitive_assessments
  for insert to anon, authenticated
  with check (true);

-- SELECT: admins veem tudo; aluno logado vê os próprios resultados
drop policy if exists cognitive_select on public.cognitive_assessments;
create policy cognitive_select on public.cognitive_assessments
  for select to anon, authenticated
  using (public.is_admin() or student_id = auth.uid());

-- DELETE: só admin (limpeza de testes)
drop policy if exists cognitive_delete on public.cognitive_assessments;
create policy cognitive_delete on public.cognitive_assessments
  for delete to authenticated
  using (public.is_admin());

create index if not exists idx_cognitive_student on public.cognitive_assessments (student_id);
create index if not exists idx_cognitive_created on public.cognitive_assessments (created_at desc);
