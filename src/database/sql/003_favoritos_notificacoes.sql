-- Favoritos (cursos que o usuário marcou pra acessar rápido depois) e
-- notificações in-app (curso em alta, curso parecido com um favorito, etc).
--
-- Também cria uma linha padrão em app_configuracoes para usuários que já
-- existiam antes dessa coluna ser usada de verdade pelo backend (nome/senha
-- foram criados sem configuração associada até agora).
--
-- Rode este script uma vez em cada ambiente (local, depois dev, depois
-- produção). Idempotente.

CREATE TABLE IF NOT EXISTS app_favoritos (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES app_usuarios(id) ON DELETE CASCADE,
  codigo_curso INTEGER NOT NULL,
  sigla_universidade VARCHAR(20) NOT NULL,
  curso VARCHAR(255) NOT NULL,
  nome_universidade VARCHAR(255),
  uf_campus VARCHAR(2),
  campus VARCHAR(255),
  grau VARCHAR(50),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (usuario_id, codigo_curso, sigla_universidade)
);

CREATE TABLE IF NOT EXISTS app_notificacoes (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES app_usuarios(id) ON DELETE CASCADE,
  tipo VARCHAR(30) NOT NULL,
  titulo VARCHAR(255) NOT NULL,
  mensagem TEXT NOT NULL,
  lida BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notificacoes_usuario ON app_notificacoes(usuario_id, created_at DESC);

-- Backfill: garante uma linha de configurações pra todo usuário que ainda
-- não tem uma (necessário pra persistir tema/notificações).
INSERT INTO app_configuracoes (usuario_id, notif_cursos, notif_atualizacoes, notif_mensagens, efeitos_sonoros, animacoes, tema, idioma)
SELECT u.id, FALSE, FALSE, FALSE, TRUE, TRUE, 'light', 'pt'
FROM app_usuarios u
WHERE NOT EXISTS (
  SELECT 1 FROM app_configuracoes c WHERE c.usuario_id = u.id
);
