-- =====================================================================
-- Corrige constraint de status em submissions
-- =====================================================================
-- PROBLEMA: A constraint original só aceita ('pending','completed','graded').
-- O código usa também 'pending_ai', 'plagiarism_suspected', 'annulled' e
-- 'manual_grade'. Isso fazia com que simulados com questões discursivas,
-- redações e provas anuladas falhassem ao salvar (CHECK violation), e as
-- submissões nunca chegavam ao banco.
--
-- COMO RODAR: Supabase Dashboard → SQL Editor → cole e execute.
-- É idempotente — pode rodar mais de uma vez sem problema.
-- =====================================================================

-- 1) Remove a constraint antiga e recria com todos os valores usados
ALTER TABLE public.submissions
  DROP CONSTRAINT IF EXISTS submissions_status_check;

ALTER TABLE public.submissions
  ADD CONSTRAINT submissions_status_check
  CHECK (status IN (
    'pending',
    'completed',
    'graded',
    'pending_ai',
    'plagiarism_suspected',
    'annulled',
    'manual_grade'
  ));

-- 2) Garante que a coluna device_id existe (usada pelo EvaluationView)
ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS device_id TEXT;

-- 3) Verificação: conta quantas submissões existem por status
SELECT status, COUNT(*) AS total
FROM public.submissions
GROUP BY status
ORDER BY total DESC;
