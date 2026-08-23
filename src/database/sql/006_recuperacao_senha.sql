-- Recuperação de senha ("esqueci minha senha"): guarda o hash do token de
-- redefinição e sua expiração. O token em si (não o hash) só existe no link
-- enviado por e-mail — nunca é persistido em texto puro no banco.
--
-- Rode este script uma vez em cada ambiente (local, depois dev, depois
-- produção). Idempotente.

ALTER TABLE app_usuarios
  ADD COLUMN IF NOT EXISTS reset_token_hash VARCHAR,
  ADD COLUMN IF NOT EXISTS reset_token_expira_em TIMESTAMP;

-- reset_token_hash: SHA-256 do token enviado por e-mail, null quando não há
-- solicitação de redefinição pendente.
-- reset_token_expira_em: validade do token (1h a partir da solicitação).
