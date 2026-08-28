import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Importação de planilha passou a rodar em background (ver
 * ImportacaoController.confirmar): a requisição HTTP não fica mais presa
 * esperando os inserts em lote terminarem — para uma planilha de dezenas de
 * milhares de linhas, isso estourava o timeout do proxy em homologação/
 * produção e devolvia 502 mesmo com a importação ainda rodando no servidor.
 *
 * `status` rastreia o andamento ('processando' | 'concluido' | 'erro') pro
 * admin acompanhar via GET /admin/importacoes/:id (polling). Linhas
 * existentes (importações antigas, síncronas) recebem 'concluido' — já
 * tinham terminado quando foram gravadas.
 */
export class StatusImportacaoAssincrona1788200000000 implements MigrationInterface {
  name = "StatusImportacaoAssincrona1788200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "app_importacoes"
        ADD COLUMN "status" varchar NOT NULL DEFAULT 'concluido',
        ADD COLUMN "mensagem_erro" varchar
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "app_importacoes"
        DROP COLUMN "status",
        DROP COLUMN "mensagem_erro"
    `);
  }
}
