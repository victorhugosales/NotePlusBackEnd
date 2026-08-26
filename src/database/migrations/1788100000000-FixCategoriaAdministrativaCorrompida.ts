import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Corrige um valor corrompido em "DS_CATEGORIA_ADM" (coluna mapeada como
 * `categoria_administrativa` na Entity NotasCorte): a linha id_projeto
 * 76624 (SISU 2025, UFSCAR, Química, modalidade LB_EP) tem o texto
 * "P<U+FFFD><U+FFFD>blica Federal" em vez de "Pública Federal" — os dois
 * caracteres de substituição (U+FFFD) já estão gravados como dado real na
 * coluna, não é um artefato de decodificação na leitura. Isolado (só essa
 * linha, confirmado via /categorias-disponiveis + busca por igualdade
 * exata), diferente do bug de espaço em branco na modalidade de 2025 (ver
 * TrimModalidadeNotasDeCortes), que afetava a edição inteira.
 *
 * Efeito visível do bug: o filtro "Categoria" da aba Faculdades listava
 * "Pública Federal" duas vezes (a versão correta e essa corrompida),
 * confundindo quem via a lista.
 *
 * A correção é seletiva por padrão (substring "blica Federal" com os dois
 * caracteres de substituição antes dela), não um TRIM/replace genérico —
 * evita tocar em qualquer outra linha que por acaso tenha
 * "Pública Federal" corretamente.
 */
export class FixCategoriaAdministrativaCorrompida1788100000000 implements MigrationInterface {
  name = "FixCategoriaAdministrativaCorrompida1788100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "NotasDeCortes"
      SET "DS_CATEGORIA_ADM" = 'Pública Federal'
      WHERE "DS_CATEGORIA_ADM" = 'P' || chr(65533) || chr(65533) || 'blica Federal'
    `);
  }

  public async down(): Promise<void> {
    // Não restaura o valor corrompido — não há valor em desfazer isso.
  }
}
