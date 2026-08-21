import "reflect-metadata";
import "dotenv/config";
import ExcelJS from "exceljs";
import { AppDataSource } from "../database/datasource";

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
// A coluna QT_VAGAS_CONCORRENCIA da planilha é gravada na coluna física
// QT_VAGAS_OFERTADAS (nome usado nas edições anteriores e por toda a busca
// hoje) — são tratadas como o mesmo conceito entre edições do MEC.
//
// --force permite importar mesmo que já existam linhas com esse ano no
// banco (não apaga as existentes, só adiciona mais).

const COLUNAS_PLANILHA = [
  "EDICAO", "CO_IES", "NO_IES", "SG_IES", "DS_ORGANIZACAO_ACADEMICA",
  "DS_CATEGORIA_ADM", "NO_CAMPUS", "NO_MUNICIPIO_CAMPUS", "SG_UF_CAMPUS",
  "DS_REGIAO_CAMPUS", "CO_IES_CURSO", "NO_CURSO", "DS_GRAU", "DS_TURNO",
  "TP_MOD_CONCORRENCIA", "TIPO_CONCORRENCIA", "DS_MOD_CONCORRENCIA",
  "NU_PERCENTUAL_BONUS", "QT_VAGAS_CONCORRENCIA", "NU_NOTACORTE", "QT_INSCRICAO"
];

const TAMANHO_LOTE = 500;

function getText(row: ExcelJS.Row, colIndex: Record<string, number>, coluna: string): string {
  const idx = colIndex[coluna];
  if (!idx) return "";
  const texto = row.getCell(idx).text;
  return texto ? texto.toString().trim() : "";
}

function getNumber(row: ExcelJS.Row, colIndex: Record<string, number>, coluna: string): number {
  const idx = colIndex[coluna];
  if (!idx) return 0;
  const cell = row.getCell(idx);
  const valor = typeof cell.value === "number" ? cell.value : Number(cell.text);
  return Number.isFinite(valor) ? valor : 0;
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
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(arquivo);

    const sheet = workbook.worksheets.find(
      (ws) => ws.rowCount > 1 && (ws.getRow(1).getCell(1).text || "").trim() === "EDICAO"
    );
    if (!sheet) {
      console.error('Não encontrei nenhuma aba com cabeçalho "EDICAO" na primeira coluna.');
      process.exit(1);
    }

    const colIndex: Record<string, number> = {};
    sheet.getRow(1).eachCell((cell, colNumber) => {
      colIndex[(cell.text || "").trim()] = colNumber;
    });

    const faltando = COLUNAS_PLANILHA.filter((c) => !(c in colIndex));
    if (faltando.length > 0) {
      console.error("Colunas esperadas não encontradas na planilha:", faltando.join(", "));
      process.exit(1);
    }

    const totalLinhas = sheet.rowCount - 1;
    console.log(`${totalLinhas} linhas encontradas. Importando com EDICAO=${ano}...`);

    let lote: unknown[][] = [];
    let inseridas = 0;

    const inserirLote = async () => {
      if (lote.length === 0) return;

      const placeholders: string[] = [];
      const valores: unknown[] = [];
      lote.forEach((linha, i) => {
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
      inseridas += lote.length;
      lote = [];
      console.log(`  ${inseridas}/${totalLinhas} linhas importadas...`);
    };

    for (let i = 2; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i);
      if (!row.hasValues) continue;

      lote.push([
        ano, // EDICAO normalizado (ver comentário no topo do arquivo)
        getNumber(row, colIndex, "CO_IES"),
        getText(row, colIndex, "NO_IES"),
        getText(row, colIndex, "SG_IES"),
        getText(row, colIndex, "DS_ORGANIZACAO_ACADEMICA"),
        getText(row, colIndex, "DS_CATEGORIA_ADM"),
        getText(row, colIndex, "NO_CAMPUS"),
        getText(row, colIndex, "NO_MUNICIPIO_CAMPUS"),
        getText(row, colIndex, "SG_UF_CAMPUS"),
        getText(row, colIndex, "DS_REGIAO_CAMPUS"),
        getNumber(row, colIndex, "CO_IES_CURSO"),
        getText(row, colIndex, "NO_CURSO"),
        getText(row, colIndex, "DS_GRAU"),
        getText(row, colIndex, "DS_TURNO"),
        getText(row, colIndex, "TP_MOD_CONCORRENCIA"),
        getText(row, colIndex, "TIPO_CONCORRENCIA"),
        getText(row, colIndex, "DS_MOD_CONCORRENCIA"),
        getNumber(row, colIndex, "NU_PERCENTUAL_BONUS"),
        getNumber(row, colIndex, "QT_VAGAS_CONCORRENCIA"), // -> QT_VAGAS_OFERTADAS
        getNumber(row, colIndex, "NU_NOTACORTE"),
        getNumber(row, colIndex, "QT_INSCRICAO"),
      ]);

      if (lote.length >= TAMANHO_LOTE) {
        await inserirLote();
      }
    }
    await inserirLote();

    console.log(`Pronto: ${inseridas} linhas importadas com EDICAO=${ano}.`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error("Erro na importação:", error);
  process.exit(1);
});
