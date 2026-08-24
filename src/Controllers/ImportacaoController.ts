import { Response } from "express";
import { AppDataSource } from "../database/datasource";
import { ImportacaoNotas } from "../Entities/ImportacaoNotas";
import { AuthRequest } from "../middlewares/authMiddleware";
import { abrirPlanilha, validarLinhas, PlanilhaInvalidaError, LinhaValida } from "../services/importacaoNotas";
import { statsCache, STATS_CACHE_KEY, anosCache, ANOS_CACHE_KEY } from "../cache/searchCache";

const TAMANHO_LOTE = 500;
const ANO_MINIMO = 2010;
const ANO_MAXIMO = new Date().getFullYear() + 1;

interface RequestComArquivo extends AuthRequest {
  file?: Express.Multer.File | undefined;
}

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

function validarAno(anoBruto: unknown): number | null {
  const ano = Number(anoBruto);
  if (!Number.isInteger(ano) || ano < ANO_MINIMO || ano > ANO_MAXIMO) return null;
  return ano;
}

export class ImportacaoController {
  // Passo 1: só analisa a planilha (parsing + validação linha a linha) —
  // não grava nada no banco. Devolve um relatório pro admin revisar antes
  // de confirmar.
  async analisar(req: RequestComArquivo, res: Response) {
    if (!req.file) return res.status(400).json({ error: "Envie um arquivo de planilha (.xlsx)" });

    const ano = validarAno(req.body.ano);
    if (!ano) return res.status(400).json({ error: `Informe um ano entre ${ANO_MINIMO} e ${ANO_MAXIMO}` });

    try {
      const { sheet, colIndex } = await abrirPlanilha(req.file.buffer);
      const { totalLinhas, validas, comErro } = validarLinhas(sheet, colIndex, ano);

      const existentes = await AppDataSource.query(
        `SELECT COUNT(*) AS total FROM "NotasDeCortes" WHERE "EDICAO" = $1`,
        [ano]
      );
      const totalExistente = Number(existentes[0].total);

      return res.json({
        totalLinhas,
        totalValidas: validas.length,
        totalComErro: comErro.length,
        erros: comErro.slice(0, 100), // relatório completo pode ter milhares de linhas; mostra as 100 primeiras
        anoJaTemDados: totalExistente > 0,
        totalLinhasExistentes: totalExistente,
      });
    } catch (error) {
      if (error instanceof PlanilhaInvalidaError) {
        return res.status(400).json({ error: error.message });
      }
      console.error(error);
      return res.status(500).json({ error: "Erro ao analisar a planilha" });
    }
  }

  // Passo 2: reprocessa o mesmo arquivo (o admin reenvia — nada fica
  // guardado no servidor entre os dois passos) e grava de fato, dentro de
  // uma transação. `substituir=true` apaga os dados existentes do ano antes
  // de inserir os novos; sem isso, a rota recusa se o ano já tiver dados
  // (mesma trava do script de terminal).
  async confirmar(req: RequestComArquivo, res: Response) {
    if (!req.file) return res.status(400).json({ error: "Envie um arquivo de planilha (.xlsx)" });
    if (!req.userId) return res.status(401).json({ error: "Não autenticado" });

    const ano = validarAno(req.body.ano);
    if (!ano) return res.status(400).json({ error: `Informe um ano entre ${ANO_MINIMO} e ${ANO_MAXIMO}` });

    const substituir = req.body.substituir === "true" || req.body.substituir === true;

    try {
      const { sheet, colIndex } = await abrirPlanilha(req.file.buffer);
      const { totalLinhas, validas, comErro } = validarLinhas(sheet, colIndex, ano);

      const existentes = await AppDataSource.query(
        `SELECT COUNT(*) AS total FROM "NotasDeCortes" WHERE "EDICAO" = $1`,
        [ano]
      );
      const totalExistente = Number(existentes[0].total);

      if (totalExistente > 0 && !substituir) {
        return res.status(409).json({
          error: `Já existem ${totalExistente} linhas para o ano ${ano}. Confirme com "substituir" para apagar e reimportar.`,
        });
      }

      await AppDataSource.transaction(async (manager) => {
        if (totalExistente > 0 && substituir) {
          await manager.query(`DELETE FROM "NotasDeCortes" WHERE "EDICAO" = $1`, [ano]);
        }
        for (let i = 0; i < validas.length; i += TAMANHO_LOTE) {
          await inserirLote(validas.slice(i, i + TAMANHO_LOTE));
        }
      });

      const importacaoRepo = AppDataSource.getRepository(ImportacaoNotas);
      await importacaoRepo.save(
        importacaoRepo.create({
          usuario_id: req.userId,
          ano,
          nome_arquivo: req.file.originalname,
          total_linhas: totalLinhas,
          linhas_importadas: validas.length,
          linhas_com_erro: comErro.length,
          modo: totalExistente > 0 ? "substituiu" : "adicionou",
        })
      );

      // Dashboard e seletores de ano dependem desses dados — sem isso, o
      // ano recém-importado só apareceria depois dos 30 minutos de TTL.
      statsCache.delete(STATS_CACHE_KEY);
      anosCache.delete(ANOS_CACHE_KEY);

      return res.json({
        message: `${validas.length} linhas importadas para o ano ${ano}.`,
        totalLinhas,
        totalImportadas: validas.length,
        totalComErro: comErro.length,
      });
    } catch (error) {
      if (error instanceof PlanilhaInvalidaError) {
        return res.status(400).json({ error: error.message });
      }
      console.error(error);
      return res.status(500).json({ error: "Erro ao importar a planilha" });
    }
  }

  async listarHistorico(_req: RequestComArquivo, res: Response) {
    try {
      const repo = AppDataSource.getRepository(ImportacaoNotas);
      const importacoes = await repo.find({ order: { created_at: "DESC" }, take: 50 });
      return res.json(importacoes);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Erro ao buscar histórico de importações" });
    }
  }
}
