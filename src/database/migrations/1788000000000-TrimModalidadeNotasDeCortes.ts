import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Corrige dados sujos em "TIPO_CONCORRENCIA" (coluna mapeada como
 * `modalidade` na Entity NotasCorte): algumas linhas da edição 2025 do SISU
 * vieram com espaços em branco à direita (ex.: "LI_EP  " em vez de
 * "LI_EP"), provavelmente de um pipeline de importação anterior ao
 * `src/services/importacaoNotas.ts` atual (esse já usa `.trim()` em
 * `getCellText`, então importações novas não sofrem disso).
 *
 * Efeito visível do bug: o front-end agrupa a evolução da nota de corte por
 * ano usando o valor bruto de `modalidade` como chave (ver
 * `dadosComparativo` em `NotePlus/src/Pages/Detalhes/index.jsx`). Uma
 * modalidade com "LI_EP" em 2024/2026 e "LI_EP  " em 2025 vira, pro
 * agrupamento, duas modalidades diferentes — a "suja" de 2025 fica sozinha
 * (só 1 ano) e é descartada por não formar linha de comparação, então o
 * gráfico mostra 2024 e 2026 só, sem 2025 pra aquela modalidade. A Visão
 * Simplificada não sofre com isso porque lista os cards de um ano só, sem
 * agrupar por modalidade entre edições.
 *
 * DS_MOD_CONCORRENCIA (texto descritivo, não usado pra agrupar/comparar)
 * também é aparado por consistência, mas não é o que causa o bug.
 *
 * down() é um no-op: remover espaços em branco não é uma perda de
 * informação que valha a pena restaurar.
 */
export class TrimModalidadeNotasDeCortes1788000000000 implements MigrationInterface {
  name = "TrimModalidadeNotasDeCortes1788000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "NotasDeCortes"
      SET "TIPO_CONCORRENCIA" = TRIM("TIPO_CONCORRENCIA")
      WHERE "TIPO_CONCORRENCIA" <> TRIM("TIPO_CONCORRENCIA")
    `);
    await queryRunner.query(`
      UPDATE "NotasDeCortes"
      SET "DS_MOD_CONCORRENCIA" = TRIM("DS_MOD_CONCORRENCIA")
      WHERE "DS_MOD_CONCORRENCIA" <> TRIM("DS_MOD_CONCORRENCIA")
    `);
  }

  public async down(): Promise<void> {
    // Não restaura os espaços em branco removidos — não há valor em desfazer isso.
  }
}
