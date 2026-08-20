-- Índices de performance para as buscas de notas de corte (/pesquisar, /sugestoes).
--
-- Diagnóstico (EXPLAIN ANALYZE em produção, 2026): as buscas por ILIKE fazem
-- Seq Scan completo na tabela "NotasDeCortes" porque não existe nenhum índice
-- além da chave primária, e um índice B-tree comum não serve para
-- `ILIKE '%termo%'` (wildcard no início).
--
-- Rode este script uma vez no SQL Editor do Supabase (homologação e, quando
-- for a hora, produção). Todos os comandos são idempotentes (IF NOT EXISTS).

-- 1. Extensões necessárias
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 2. Wrapper IMMUTABLE para unaccent()
--    A função unaccent() do Postgres é STABLE, não IMMUTABLE (depende do
--    dicionário de busca textual configurado na sessão). Por isso o Postgres
--    recusa `CREATE INDEX ... (unaccent(coluna))` com o erro:
--    "functions in index expression must be marked IMMUTABLE".
--    A solução padrão é este wrapper, declarando IMMUTABLE (é seguro: não
--    muda em runtime nesta aplicação).
--    O Supabase instala as extensões no schema "extensions" (não no
--    "public"), por isso fixamos o search_path da função pra cobrir os dois
--    casos — senão o Postgres não encontra o dicionário "unaccent".
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text AS $$
  SELECT unaccent($1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
SET search_path = public, extensions;

-- 3. Índices GIN de trigrama nas colunas usadas com ILIKE '%termo%'
--    (um índice GIN trigram acelera ILIKE automaticamente, sem precisar
--    trocar a sintaxe da query por similarity()/%).
CREATE INDEX IF NOT EXISTS idx_notascorte_curso_trgm
  ON "NotasDeCortes" USING gin (immutable_unaccent("NO_CURSO") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_notascorte_sigla_trgm
  ON "NotasDeCortes" USING gin ("SG_IES" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_notascorte_nome_uni_trgm
  ON "NotasDeCortes" USING gin ("NO_IES" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_notascorte_cidade_trgm
  ON "NotasDeCortes" USING gin ("NO_MUNICIPIO_CAMPUS" gin_trgm_ops);

-- 4. Índices B-tree normais nas colunas de igualdade exata (sem ILIKE)
CREATE INDEX IF NOT EXISTS idx_notascorte_codigo_curso
  ON "NotasDeCortes" ("CO_IES_CURSO");

CREATE INDEX IF NOT EXISTS idx_notascorte_ano
  ON "NotasDeCortes" ("EDICAO");

-- 5. Conferir que os índices foram criados
-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'NotasDeCortes';
