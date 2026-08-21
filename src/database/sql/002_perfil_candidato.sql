-- Adiciona campos de perfil do candidato (nota do ENEM e modalidades de
-- concorrência que ele participa) na tabela de usuários.
--
-- Rode este script uma vez em cada ambiente (local, depois dev, depois
-- produção). Idempotente (IF NOT EXISTS).

ALTER TABLE app_usuarios
  ADD COLUMN IF NOT EXISTS nota_enem NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS modalidades TEXT;

-- nota_enem: nota do ENEM do usuário (0 a 1000), null = não informada.
-- modalidades: lista das modalidades de concorrência que o usuário participa
-- (AC, LB_PPI, LI_PPI, LB_Q, LI_Q, LB_PCD, LI_PCD, LB_EP, LI_EP), guardada
-- como texto separado por vírgula (ex.: "AC,LB_EP"). O backend valida contra
-- essa lista fixa antes de salvar.
