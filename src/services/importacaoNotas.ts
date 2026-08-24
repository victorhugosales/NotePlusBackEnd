import ExcelJS from "exceljs";

// Lógica de leitura/validação de planilhas de notas de corte do SISU/INEP,
// compartilhada entre o script de terminal (src/scripts/importarNotasCorte.ts)
// e a rota de importação usada pelo admin na interface
// (src/Controllers/ImportacaoController.ts) — mesma regra nos dois lugares,
// sem duplicar.

export const COLUNAS_PLANILHA = [
  "EDICAO", "CO_IES", "NO_IES", "SG_IES", "DS_ORGANIZACAO_ACADEMICA",
  "DS_CATEGORIA_ADM", "NO_CAMPUS", "NO_MUNICIPIO_CAMPUS", "SG_UF_CAMPUS",
  "DS_REGIAO_CAMPUS", "CO_IES_CURSO", "NO_CURSO", "DS_GRAU", "DS_TURNO",
  "TP_MOD_CONCORRENCIA", "TIPO_CONCORRENCIA", "DS_MOD_CONCORRENCIA",
  "NU_PERCENTUAL_BONUS", "QT_VAGAS_CONCORRENCIA", "NU_NOTACORTE", "QT_INSCRICAO",
];

// A coluna de vagas mudou de nome entre edições do MEC: planilhas de 2024 e
// anteriores trazem "QT_VAGAS_OFERTADAS", já 2026 em diante traz
// "QT_VAGAS_CONCORRENCIA" — mesmo conceito, nomes diferentes. Aceita
// qualquer um dos dois (nessa ordem de preferência).
const NOMES_COLUNA_VAGAS = ["QT_VAGAS_CONCORRENCIA", "QT_VAGAS_OFERTADAS"];

const UFS_VALIDAS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
];

// Campos de texto obrigatórios (não podem vir vazios da planilha). DS_TURNO
// fica de fora de propósito — nem toda oferta tem turno definido (ex. EAD).
const CAMPOS_TEXTO_OBRIGATORIOS = [
  "NO_IES", "SG_IES", "NO_CAMPUS", "NO_MUNICIPIO_CAMPUS", "SG_UF_CAMPUS",
  "CO_IES_CURSO", "NO_CURSO", "DS_GRAU", "TIPO_CONCORRENCIA", "DS_MOD_CONCORRENCIA",
];

export interface LinhaValida {
  linha: number;
  valores: unknown[];
}

export interface LinhaComErro {
  linha: number;
  erros: string[];
}

export interface ResultadoValidacao {
  totalLinhas: number;
  validas: LinhaValida[];
  comErro: LinhaComErro[];
}

export class PlanilhaInvalidaError extends Error {}

function getCellText(row: ExcelJS.Row, colIndex: Record<string, number>, coluna: string): string {
  const idx = colIndex[coluna];
  if (!idx) return "";
  const texto = row.getCell(idx).text;
  return texto ? texto.toString().trim() : "";
}

function getCellNumberRaw(row: ExcelJS.Row, colIndex: Record<string, number>, coluna: string): number | null {
  const idx = colIndex[coluna];
  if (!idx) return null;
  const cell = row.getCell(idx);
  const valor = typeof cell.value === "number" ? cell.value : Number(cell.text);
  return Number.isFinite(valor) ? valor : null;
}

// Abre o arquivo, encontra a aba com cabeçalho "EDICAO" na primeira coluna
// e confere se todas as colunas esperadas existem. Lança PlanilhaInvalidaError
// (mensagem já pronta pra exibir ao admin) se a estrutura não bater.
export async function abrirPlanilha(buffer: Buffer): Promise<{ sheet: ExcelJS.Worksheet; colIndex: Record<string, number> }> {
  const workbook = new ExcelJS.Workbook();
  // Cast pontual: os tipos do exceljs esperam o Buffer não-genérico de uma
  // versão mais antiga do @types/node; em runtime é o mesmo Buffer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);

  const sheet = workbook.worksheets.find(
    (ws) => ws.rowCount > 1 && (ws.getRow(1).getCell(1).text || "").trim() === "EDICAO"
  );
  if (!sheet) {
    throw new PlanilhaInvalidaError('Não encontrei nenhuma aba com cabeçalho "EDICAO" na primeira coluna.');
  }

  const colIndex: Record<string, number> = {};
  sheet.getRow(1).eachCell((cell, colNumber) => {
    colIndex[(cell.text || "").trim()] = colNumber;
  });

  // Aponta o nome canônico "QT_VAGAS_CONCORRENCIA" pra qualquer uma das
  // variantes encontradas (ver comentário em NOMES_COLUNA_VAGAS) — o resto
  // do código sempre lê por esse nome, sem precisar saber da variação.
  const colunaVagas = NOMES_COLUNA_VAGAS.find((nome) => nome in colIndex);
  const idxVagas = colunaVagas ? colIndex[colunaVagas] : undefined;
  if (idxVagas !== undefined) colIndex["QT_VAGAS_CONCORRENCIA"] = idxVagas;

  const faltando = COLUNAS_PLANILHA.filter((c) => !(c in colIndex)).map((c) =>
    c === "QT_VAGAS_CONCORRENCIA" ? `${c} (ou ${NOMES_COLUNA_VAGAS.slice(1).join("/")})` : c
  );
  if (faltando.length > 0) {
    throw new PlanilhaInvalidaError(`Colunas esperadas não encontradas na planilha: ${faltando.join(", ")}`);
  }

  return { sheet, colIndex };
}

// Valida linha a linha e devolve dois grupos: as prontas pra inserir (já no
// formato de array posicional que o INSERT em lote espera) e as com erro
// (motivo detalhado, linha não entra na importação). Uma planilha grande
// pode ter algumas linhas ruins sem que isso invalide o resto.
export function validarLinhas(
  sheet: ExcelJS.Worksheet,
  colIndex: Record<string, number>,
  ano: number
): ResultadoValidacao {
  const validas: LinhaValida[] = [];
  const comErro: LinhaComErro[] = [];
  let totalLinhas = 0;

  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    if (!row.hasValues) continue;
    totalLinhas++;

    const erros: string[] = [];

    for (const campo of CAMPOS_TEXTO_OBRIGATORIOS) {
      if (!getCellText(row, colIndex, campo)) {
        erros.push(`${campo} está vazio`);
      }
    }

    const uf = getCellText(row, colIndex, "SG_UF_CAMPUS");
    if (uf && !UFS_VALIDAS.includes(uf.toUpperCase())) {
      erros.push(`SG_UF_CAMPUS "${uf}" não é uma UF válida`);
    }

    const coIes = getCellNumberRaw(row, colIndex, "CO_IES");
    if (coIes === null || coIes <= 0) {
      erros.push("CO_IES ausente ou inválido");
    }

    const coIesCurso = getCellNumberRaw(row, colIndex, "CO_IES_CURSO");
    if (coIesCurso === null || coIesCurso <= 0) {
      erros.push("CO_IES_CURSO ausente ou inválido");
    }

    const notaCorte = getCellNumberRaw(row, colIndex, "NU_NOTACORTE");
    if (notaCorte === null || notaCorte < 0 || notaCorte > 1000) {
      erros.push("NU_NOTACORTE ausente ou fora do intervalo 0–1000");
    }

    const vagas = getCellNumberRaw(row, colIndex, "QT_VAGAS_CONCORRENCIA");
    if (vagas === null || vagas < 0) {
      erros.push("QT_VAGAS_CONCORRENCIA ausente ou negativa");
    }

    const inscricoes = getCellNumberRaw(row, colIndex, "QT_INSCRICAO");
    if (inscricoes === null || inscricoes < 0) {
      erros.push("QT_INSCRICAO ausente ou negativa");
    }

    if (erros.length > 0) {
      comErro.push({ linha: i, erros });
      continue;
    }

    validas.push({
      linha: i,
      valores: [
        ano, // EDICAO normalizado — ver comentário no script CLI sobre o código interno do MEC
        coIes,
        getCellText(row, colIndex, "NO_IES"),
        getCellText(row, colIndex, "SG_IES"),
        getCellText(row, colIndex, "DS_ORGANIZACAO_ACADEMICA"),
        getCellText(row, colIndex, "DS_CATEGORIA_ADM"),
        getCellText(row, colIndex, "NO_CAMPUS"),
        getCellText(row, colIndex, "NO_MUNICIPIO_CAMPUS"),
        uf,
        getCellText(row, colIndex, "DS_REGIAO_CAMPUS"),
        coIesCurso,
        getCellText(row, colIndex, "NO_CURSO"),
        getCellText(row, colIndex, "DS_GRAU"),
        getCellText(row, colIndex, "DS_TURNO"),
        getCellText(row, colIndex, "TP_MOD_CONCORRENCIA"),
        getCellText(row, colIndex, "TIPO_CONCORRENCIA"),
        getCellText(row, colIndex, "DS_MOD_CONCORRENCIA"),
        getCellNumberRaw(row, colIndex, "NU_PERCENTUAL_BONUS") ?? 0,
        vagas, // -> QT_VAGAS_OFERTADAS
        notaCorte,
        inscricoes,
      ],
    });
  }

  return { totalLinhas, validas, comErro };
}
