-- Suporte a login social (Google): contas criadas via Google não têm
-- senha nossa, e precisam de uma forma de linkar com a conta Google.
--
-- Rode este script uma vez em cada ambiente (local, depois dev, depois
-- produção). Idempotente.

ALTER TABLE app_usuarios
  ALTER COLUMN senha_hash DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS google_id VARCHAR UNIQUE;

-- senha_hash: agora aceita NULL — contas via Google não têm senha nossa.
-- google_id: claim "sub" do token do Google (identificador estável da
-- conta Google), único por usuário. NULL para quem nunca logou via Google.
