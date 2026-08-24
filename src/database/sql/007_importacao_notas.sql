-- Área administrativa: importação de planilhas de notas de corte pela
-- interface (em vez do script de terminal), com controle de acesso e
-- auditoria de cada importação.
--
-- Rode este script uma vez em cada ambiente (local, depois dev, depois
-- produção). Idempotente.

ALTER TABLE app_usuarios
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS app_importacoes (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES app_usuarios(id) ON DELETE CASCADE,
  ano INTEGER NOT NULL,
  nome_arquivo VARCHAR(255) NOT NULL,
  total_linhas INTEGER NOT NULL,
  linhas_importadas INTEGER NOT NULL,
  linhas_com_erro INTEGER NOT NULL,
  modo VARCHAR(20) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- is_admin: acesso à área de importação de planilhas. Promova um usuário
-- direto no banco, ex.:
--   UPDATE app_usuarios SET is_admin = TRUE WHERE email = 'seu-email@exemplo.com';
--
-- app_importacoes: histórico de cada importação (dry-run não gera linha
-- aqui — só a confirmação). modo = 'adicionou' (ano estava vazio) ou
-- 'substituiu' (havia dados anteriores pro ano, foram apagados antes de
-- inserir os novos).
