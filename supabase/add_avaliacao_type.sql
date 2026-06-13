-- =====================================================================
-- Avaliações presenciais (type = 'avaliacao')
-- =====================================================================
-- Cria um novo tipo de item em bimonthly_exams: 'avaliacao'.
-- Apenas avaliações exigem geolocalização (presença na escola).
-- Simulados, redações e atividades podem ser feitos de casa.
--
-- COMO RODAR: Supabase Dashboard → SQL Editor → cole e execute.
-- É idempotente (pode rodar mais de uma vez sem problema).
-- =====================================================================

-- 1) Atualiza a CHECK constraint para aceitar 'avaliacao'
ALTER TABLE public.bimonthly_exams
  DROP CONSTRAINT IF EXISTS bimonthly_exams_type_check;

ALTER TABLE public.bimonthly_exams
  ADD CONSTRAINT bimonthly_exams_type_check
  CHECK (type = ANY (ARRAY['exam'::text, 'essay'::text, 'avaliacao'::text]));

-- 2) Garante a coluna require_geo (já deve existir)
ALTER TABLE public.bimonthly_exams
  ADD COLUMN IF NOT EXISTS require_geo BOOLEAN NOT NULL DEFAULT FALSE;

-- 3) Simulados e redações deixam de exigir geolocalização
--    (geo passa a ser exclusivo das avaliações presenciais)
UPDATE public.bimonthly_exams
  SET require_geo = FALSE
  WHERE type IN ('exam', 'essay');
