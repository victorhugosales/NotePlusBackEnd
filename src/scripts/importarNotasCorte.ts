import "reflect-metadata";
import "dotenv/config";
import { readFile } from "fs/promises";
import { AppDataSource } from "../database/datasource";
import { abrirPlanilha, validarLinhas, PlanilhaInvalidaError, LinhaValida } from "../services/importacaoNotas";

// Importa uma planilha de notas de corte do SISU/INEP (formato do Portal
// Único de Acesso) para a tabela NotasDeCortes, normalizando o ano.
//
// Uso:
//   APP_ENV=local npm run import:notas -- <arquivo.xlsx> <ano> [--force]
//
// Exemplo (dados de 2026, banco local):
//   APP_ENV=local npm run import:notas -- ./sisu2026.xlsx 2026
//
// O <ano> é sempre gravado como informado (ex.: 2026), independente do
// valor bruto da coluna EDICAO na planilha — a partir de 2024 o MEC usa um
// código sequencial interno ali (ex.: 302), não o ano civil. Normalizamos
// pra manter a mesma semântica usada nos dados já importados (EDICAO/ano =
// ano civil), sem o que os filtros e a priorização por ano quebrariam.
//
// --force permite importar mesmo que já existam linhas com esse ano no
// banco (não apaga as existentes, só adiciona mais).
//
// Parsing e validação de linhas ficam em src/services/importacaoNotas.ts,
// compartilhado com a rota de importação usada pelo admin na interface.

const TAMANHO_LOTE = 500;

async function inserirLote(lote: LinhaValida[]) {
  if (lote.length === 0) return;

  const placeholders: string[] = [];
  const valores: unknown[] = [];
  lote.forEach(({ valores: linha }, i) => {
    const base = i * linha.length;
    placeholders.push(`(${linha.map((_, j) => `$${base + j + 1}`).join(", ")})`);
    valores.push(...linha);
  });

  const sql = `
    INSERT INTO "NotasDeCortes" (
      "EDICAO", "CO_IES", "NO_IES", "SG_IES", "DS_ORGANIZACAO_ACADEMICA",
      "DS_CATEGORIA_ADM", "NO_CAMPUS", "NO_MUNICIPIO_CAMPUS", "SG_UF_CAMPUS",
      "DS_REGIAO_CAMPUS", "CO_IES_CURSO", "NO_CURSO", "DS_GRAU", "DS_TURNO",
      "TP_MOD_CONCORRENCIA", "TIPO_CONCORRENCIA", "DS_MOD_CONCORRENCIA",
      "NU_PERCENTUAL_BONUS", "QT_VAGAS_OFERTADAS", "NU_NOTACORTE", "QT_INSCRICAO"
    ) VALUES ${placeholders.join(", ")}
  `;

  await AppDataSource.query(sql, valores);
}

async function main() {
  const [, , arquivo, anoArg, ...flags] = process.argv;
  const force = flags.includes("--force");

  if (!arquivo || !anoArg) {
    console.error("Uso: npm run import:notas -- <arquivo.xlsx> <ano> [--force]");
    process.exit(1);
  }

  const ano = Number(anoArg);
  if (!Number.isInteger(ano)) {
    console.error(`Ano inválido: "${anoArg}"`);
    process.exit(1);
  }

  await AppDataSource.initialize();

  try {
    const existentes = await AppDataSource.query(
      `SELECT COUNT(*) AS total FROM "NotasDeCortes" WHERE "EDICAO" = $1`,
      [ano]
    );
    const totalExistente = Number(existentes[0].total);
    if (totalExistente > 0 && !force) {
      console.error(
        `Já existem ${totalExistente} linhas com EDICAO=${ano} no banco. ` +
        `Rode de novo com --force pra importar mesmo assim (não remove as existentes, só adiciona).`
      );
      process.exit(1);
    }

    console.log(`Lendo ${arquivo}...`);
    const buffer = await readFile(arquivo);
    const { sheet, colIndex } = await abrirPlanilha(buffer);

    const { totalLinhas, validas, comErro } = validarLinhas(sheet, colIndex, ano);
    console.log(`${totalLinhas} linhas encontradas (${validas.length} válidas, ${comErro.length} com erro).`);

    if (comErro.length > 0) {
      console.warn("Linhas ignoradas por erro de validação:");
      for (const { linha, erros } of comErro.slice(0, 20)) {
        console.warn(`  linha ${linha}: ${erros.join("; ")}`);
      }
      if (comErro.length > 20) console.warn(`  ... e mais ${comErro.length - 20} linha(s).`);
    }

    console.log(`Importando ${validas.length} linhas com EDICAO=${ano}...`);

    await AppDataSource.transaction(async () => {
      for (let i = 0; i < validas.length; i += TAMANHO_LOTE) {
        const lote = validas.slice(i, i + TAMANHO_LOTE);
        await inserirLote(lote);
        console.log(`  ${Math.min(i + TAMANHO_LOTE, validas.length)}/${validas.length} linhas importadas...`);
      }
    });

    console.log(`Pronto: ${validas.length} linhas importadas com EDICAO=${ano}.`);
  } catch (error) {
    if (error instanceof PlanilhaInvalidaError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error("Erro na importação:", error);
  process.exit(1);
});
