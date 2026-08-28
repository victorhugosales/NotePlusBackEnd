import ExcelJS from "exceljs";
import { Readable } from "stream";

// Lógica de leitura/validação de planilhas de notas de corte do SISU/INEP,
// compartilhada entre o script de terminal (src/scripts/importarNotasCorte.ts)
// e a rota de importação usada pelo admin na interface
// (src/Controllers/ImportacaoController.ts) — mesma regra nos dois lugares,
// sem duplicar.
//
// Lê em modo streaming (ExcelJS.stream.xlsx.WorkbookReader), linha por linha,
// em vez de workbook.xlsx.load() (carrega a planilha inteira num modelo de
// objetos em memória). Uma planilha do SISU passa de 50-60 mil linhas — em
// homologação/produção (memória limitada do host), o load() completo
// derrubava o processo (Node abortava por estourar o limite de heap,
// "Exited with status 134" no Render) antes mesmo de responder à requisição.

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

// Monta o colIndex a partir da linha de cabeçalho e confere se todas as
// colunas esperadas existem. Lança PlanilhaInvalidaError (mensagem já
// pronta pra exibir ao admin) se a estrutura não bater.
function construirColIndex(headerRow: ExcelJS.Row): Record<string, number> {
  const colIndex: Record<string, number> = {};
  headerRow.eachCell((cell, colNumber) => {
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

  return colIndex;
}

// Valida uma linha de dados (já sabendo que é a aba certa) e devolve o
// motivo caso tenha erro, ou os valores prontos pro INSERT em lote caso
// esteja tudo certo.
function validarLinha(
  row: ExcelJS.Row,
  numeroLinha: number,
  colIndex: Record<string, number>,
  ano: number
): { valida: LinhaValida } | { erro: LinhaComErro } {
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
    return { erro: { linha: numeroLinha, erros } };
  }

  return {
    valida: {
      linha: numeroLinha,
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
    },
  };
}

// Lê e valida a planilha inteira em modo streaming: acha a aba com
// cabeçalho "EDICAO" na primeira coluna, valida linha por linha sem manter
// a planilha inteira em memória (cada linha é descartada assim que
// processada). `input` aceita um Buffer (rota HTTP, arquivo já veio em
// memória via multer) ou um caminho de arquivo (script de terminal — nesse
// caso nem o arquivo inteiro é lido de uma vez, o ExcelJS abre o próprio
// stream de leitura do disco).
export async function processarPlanilha(input: Buffer | string, ano: number): Promise<ResultadoValidacao> {
  const origem = typeof input === "string" ? input : Readable.from(input);
  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(origem, {
    worksheets: "emit",
    sharedStrings: "cache",
    styles: "ignore",
    hyperlinks: "ignore",
    entries: "ignore",
  });

  let colIndex: Record<string, number> | null = null;
  const validas: LinhaValida[] = [];
  const comErro: LinhaComErro[] = [];
  let totalLinhas = 0;

  for await (const worksheetReader of workbookReader) {
    let numeroLinha = 0;
    let estaAbaEhValida = false;

    for await (const row of worksheetReader) {
      numeroLinha++;

      if (numeroLinha === 1) {
        if ((row.getCell(1).text || "").trim() !== "EDICAO") continue; // aba errada, pula (streaming não permite pular sem consumir)

        estaAbaEhValida = true;
        colIndex = construirColIndex(row);
        continue;
      }

      if (!estaAbaEhValida || !colIndex) continue;
      if (!row.hasValues) continue;

      totalLinhas++;
      const resultado = validarLinha(row, numeroLinha, colIndex, ano);
      if ("erro" in resultado) comErro.push(resultado.erro);
      else validas.push(resultado.valida);
    }

    // Já achamos e processamos a aba certa — não precisa olhar as outras
    // (encerra o WorkbookReader e libera o stream de leitura).
    if (estaAbaEhValida) break;
  }

  if (!colIndex) {
    throw new PlanilhaInvalidaError('Não encontrei nenhuma aba com cabeçalho "EDICAO" na primeira coluna.');
  }

  return { totalLinhas, validas, comErro };
}
