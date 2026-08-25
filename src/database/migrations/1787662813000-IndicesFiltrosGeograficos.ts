import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Índices de apoio aos filtros em cascata da Home (estado -> município ou
 * instituição -> cursos) e a qualquer busca que já filtrava por estado
 * (/pesquisar?uf=).
 *
 * Até aqui não existia nenhum índice em "SG_UF_CAMPUS" — toda query com
 * `uf_campus = :uf` (inclusive /municipios-disponiveis e
 * /instituicoes-disponiveis, que fazem DISTINCT ... WHERE uf_campus = :uf)
 * rodava sem índice, mesmo a tabela já sendo particionada por EDICAO (ver
 * ParticionarNotasDeCortes1756137600000). Como "NotasDeCortes" é
 * particionada, criar o índice na tabela-mãe propaga automaticamente para
 * cada partição existente.
 */
export class IndicesFiltrosGeograficos1787662813000 implements MigrationInterface {
  name = "IndicesFiltrosGeograficos1787662813000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_notascorte_uf
        ON "NotasDeCortes" ("SG_UF_CAMPUS")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_notascorte_uf_municipio
        ON "NotasDeCortes" ("SG_UF_CAMPUS", "NO_MUNICIPIO_CAMPUS")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_notascorte_uf_ies
        ON "NotasDeCortes" ("SG_UF_CAMPUS", "NO_IES")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_notascorte_uf_ies`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_notascorte_uf_municipio`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_notascorte_uf`);
  }
}
