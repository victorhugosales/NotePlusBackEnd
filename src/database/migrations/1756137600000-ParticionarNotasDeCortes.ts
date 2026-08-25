import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Transforma "NotasDeCortes" numa tabela particionada por ano (EDICAO).
 *
 * Motivação: toda busca de notas de corte já filtra por ano
 * (NotaCorteController.ts, notificacoesJob.ts). Sem particionamento, cada
 * edição nova do SISU importada deixa os índices maiores pra todo mundo,
 * mesmo quem só quer ver um ano. Particionando, o Postgres poda
 * automaticamente as partições que a query não pediu.
 *
 * Postgres não permite "ALTER TABLE ... PARTITION BY" numa tabela já
 * populada — o caminho é recriar. Resumo dos passos (ver up() abaixo):
 * renomeia a tabela atual, cria a nova já particionada (mesmas colunas,
 * via LIKE ... INCLUDING DEFAULTS INCLUDING IDENTITY — preserva também as
 * colunas que existem no banco mas não estão mapeadas na entidade
 * TypeORM, como DS_ORGANIZACAO_ACADEMICA/DS_CATEGORIA_ADM/DS_REGIAO_CAMPUS/
 * TP_MOD_CONCORRENCIA/NU_PERCENTUAL_BONUS, usadas só via SQL cru em
 * ImportacaoController.inserirLote), cria uma partição por ano já
 * existente, copia os dados, confere que a contagem bate, só então apaga
 * a tabela antiga e recria os índices (nomes idênticos aos de
 * 001_indices_busca_trgm.sql — por isso os índices originais precisam já
 * ter sido descartados junto com a tabela antiga antes de chegar aqui).
 *
 * A chave primária muda de `id_projeto` sozinho para `(id_projeto, EDICAO)`
 * — exigência do Postgres (toda PK/unique de tabela particionada precisa
 * incluir a coluna de partição). Não quebra nada: nenhuma rota do backend
 * consulta NotasDeCortes por id_projeto isolado (busca e importação sempre
 * filtram por EDICAO).
 *
 * Partições de anos novos (ex.: SISU 2027) são criadas automaticamente na
 * importação (ver ImportacaoController.confirmar) — não é preciso rodar
 * uma migration nova a cada edição.
 *
 * ATENÇÃO ao rodar em homologação/produção (Supabase): os CREATE INDEX ao
 * final não usam CONCURRENTLY (não é possível dentro de uma transação) e
 * travam escrita na tabela enquanto rodam. Para o volume de dados do SISU
 * isso deve ser rápido, mas prefira rodar fora do horário de pico e faça
 * um backup manual antes, especialmente em produção — down() é melhor
 * esforço, não substitui um backup real.
 */
export class ParticionarNotasDeCortes1756137600000 implements MigrationInterface {
  name = "ParticionarNotasDeCortes1756137600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "NotasDeCortes" RENAME TO "NotasDeCortes_legacy"`);

    await queryRunner.query(`
      CREATE TABLE "NotasDeCortes" (LIKE "NotasDeCortes_legacy" INCLUDING DEFAULTS INCLUDING IDENTITY)
      PARTITION BY LIST ("EDICAO")
    `);

    // A PK só é adicionada depois do DROP TABLE "NotasDeCortes_legacy" lá
    // embaixo, pelo mesmo motivo dos índices: RENAME TABLE não renomeia
    // constraints junto, então "NotasDeCortes_pkey" continua "ocupado"
    // pela tabela antiga (ou, numa reversão anterior, pela tabela plana)
    // até ela ser derrubada.

    // Uma partição por ano já existente na tabela antiga. EDICAO é
    // armazenada como varchar(50) no banco (não integer, apesar do nome) —
    // por isso o valor do FOR VALUES IN entra via %L (literal com aspas),
    // não %s.
    await queryRunner.query(`
      DO $$
      DECLARE
        ano_existente varchar;
      BEGIN
        FOR ano_existente IN SELECT DISTINCT "EDICAO" FROM "NotasDeCortes_legacy" ORDER BY "EDICAO"
        LOOP
          EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF "NotasDeCortes" FOR VALUES IN (%L)',
            'NotasDeCortes_' || ano_existente,
            ano_existente
          );
        END LOOP;
      END $$;
    `);

    // Copia os dados — o Postgres roteia cada linha pra partição certa
    // sozinho, com base no valor de EDICAO. id_projeto é copiado como
    // está (preserva os IDs existentes).
    await queryRunner.query(`INSERT INTO "NotasDeCortes" SELECT * FROM "NotasDeCortes_legacy"`);

    // Confere que nada ficou pra trás antes de apagar a tabela antiga.
    await queryRunner.query(`
      DO $$
      DECLARE
        total_antigo bigint;
        total_novo bigint;
      BEGIN
        SELECT COUNT(*) INTO total_antigo FROM "NotasDeCortes_legacy";
        SELECT COUNT(*) INTO total_novo FROM "NotasDeCortes";
        IF total_antigo <> total_novo THEN
          RAISE EXCEPTION 'Particionamento abortado: NotasDeCortes_legacy tem % linhas, NotasDeCortes tem % — não batem.', total_antigo, total_novo;
        END IF;
      END $$;
    `);

    // Só agora, com os dados já conferidos e a tabela antiga (e seus
    // índices) fora do caminho, recria os índices na tabela nova — os
    // nomes são os mesmos de 001_indices_busca_trgm.sql, por isso
    // precisavam estar livres. idx_notascorte_ano não é recriado: a
    // própria partição já cumpre esse papel.
    await queryRunner.query(`DROP TABLE "NotasDeCortes_legacy"`);

    await queryRunner.query(`
      ALTER TABLE "NotasDeCortes" ADD CONSTRAINT "NotasDeCortes_pkey" PRIMARY KEY (id_projeto, "EDICAO")
    `);

    await queryRunner.query(`
      CREATE INDEX idx_notascorte_curso_trgm
        ON "NotasDeCortes" USING gin (immutable_unaccent("NO_CURSO") gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_notascorte_sigla_trgm
        ON "NotasDeCortes" USING gin ("SG_IES" gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_notascorte_nome_uni_trgm
        ON "NotasDeCortes" USING gin ("NO_IES" gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_notascorte_cidade_trgm
        ON "NotasDeCortes" USING gin ("NO_MUNICIPIO_CAMPUS" gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_notascorte_codigo_curso
        ON "NotasDeCortes" ("CO_IES_CURSO")
    `);

    // A tabela nova tem sua própria sequence (criada pelo INCLUDING
    // IDENTITY, começando do 1) — sincroniza com o maior id_projeto
    // copiado, senão a próxima inserção via identity colide com um ID
    // já existente. Mesmo padrão de 004_fix_id_projeto_identity.sql.
    await queryRunner.query(`
      SELECT setval(
        pg_get_serial_sequence('"NotasDeCortes"', 'id_projeto'),
        (SELECT MAX(id_projeto) FROM "NotasDeCortes")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "NotasDeCortes" RENAME TO "NotasDeCortes_particionada"`);

    await queryRunner.query(`
      CREATE TABLE "NotasDeCortes" (LIKE "NotasDeCortes_particionada" INCLUDING DEFAULTS INCLUDING IDENTITY)
    `);

    await queryRunner.query(`INSERT INTO "NotasDeCortes" SELECT * FROM "NotasDeCortes_particionada"`);

    await queryRunner.query(`
      DO $$
      DECLARE
        total_antigo bigint;
        total_novo bigint;
      BEGIN
        SELECT COUNT(*) INTO total_antigo FROM "NotasDeCortes_particionada";
        SELECT COUNT(*) INTO total_novo FROM "NotasDeCortes";
        IF total_antigo <> total_novo THEN
          RAISE EXCEPTION 'Reversão abortada: NotasDeCortes_particionada tem % linhas, NotasDeCortes tem % — não batem.', total_antigo, total_novo;
        END IF;
      END $$;
    `);

    // Derruba a tabela particionada (e, em cascata, todas as partições por
    // ano) ANTES de recriar a PK e os índices — RENAME TABLE não renomeia
    // as constraints/índices junto, então os nomes originais (ex.:
    // "NotasDeCortes_pkey") continuam "ocupados" pela tabela antiga até
    // ela ser derrubada.
    await queryRunner.query(`DROP TABLE "NotasDeCortes_particionada"`);

    await queryRunner.query(`
      ALTER TABLE "NotasDeCortes" ADD CONSTRAINT "NotasDeCortes_pkey" PRIMARY KEY (id_projeto)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_notascorte_curso_trgm
        ON "NotasDeCortes" USING gin (immutable_unaccent("NO_CURSO") gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_notascorte_sigla_trgm
        ON "NotasDeCortes" USING gin ("SG_IES" gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_notascorte_nome_uni_trgm
        ON "NotasDeCortes" USING gin ("NO_IES" gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_notascorte_cidade_trgm
        ON "NotasDeCortes" USING gin ("NO_MUNICIPIO_CAMPUS" gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_notascorte_codigo_curso
        ON "NotasDeCortes" ("CO_IES_CURSO")
    `);
    await queryRunner.query(`
      CREATE INDEX idx_notascorte_ano
        ON "NotasDeCortes" ("EDICAO")
    `);

    await queryRunner.query(`
      SELECT setval(
        pg_get_serial_sequence('"NotasDeCortes"', 'id_projeto'),
        (SELECT MAX(id_projeto) FROM "NotasDeCortes")
      )
    `);
  }
}
