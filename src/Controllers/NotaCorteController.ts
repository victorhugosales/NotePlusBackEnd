import { Request, Response } from "express";
import { AppDataSource } from "../database/datasource";
import { NotasCorte } from "../Entities/NotasCorte";
import { Like, ILike, Raw } from "typeorm";
import { pesquisaCache, sugestoesCache, statsCache, STATS_CACHE_KEY } from "../cache/searchCache";

// A coluna QT_VAGAS_OFERTADAS não tem o mesmo tipo em todos os ambientes
// (varchar em alguns bancos, numeric/integer em outros, resquício da forma
// como os microdados do INEP foram importados). SUM() não aceita varchar
// diretamente, então convertemos para texto e depois para numeric de forma
// defensiva — funciona independente do tipo real da coluna, e trata string
// vazia como 0 em vez de quebrar a query.
//
// Referenciamos a coluna física entre aspas (nota."QT_VAGAS_OFERTADAS") em
// vez de "nota.vagas": dentro de uma expressão com cast (::text), o
// tradutor automático de alias do TypeORM não reconhece o padrão e manda
// "nota.vagas" cru pro Postgres, que não existe (o nome físico da coluna é
// outro). Referenciando a coluna física direto, isso não depende dessa
// tradução.
const SUM_VAGAS = `SUM(NULLIF(nota."QT_VAGAS_OFERTADAS"::text, '')::numeric)`;

export class NotasCorteController {
  async search(req: Request, res: Response) {
    const { curso, universidade, cidade, ano, global, codigo, uf } = req.query;
    const filtros: any = {};
    const isDetalhes = curso && universidade && global !== 'true';
    const colunasLista: any = {
      id_projeto: true,
      curso: true,
      sigla_universidade: true,
      nome_universidade: true,
      uf_campus: true,
      cidade: true,
      campus: true,
      vagas: true,
      grau: true,
      ano: true
    };

    // Cache: a mesma combinação de filtros tende a se repetir bastante
    // entre usuários diferentes (cursos/instituições populares).
    const cacheKey = JSON.stringify(req.query);
    const cached = pesquisaCache.get(cacheKey);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.json(cached);
    }

    const respond = (data: unknown) => {
      pesquisaCache.set(cacheKey, data);
      res.setHeader("X-Cache", "MISS");
      return res.json(data);
    };

    if (cidade) filtros.cidade = ILike(`%${cidade}%`);
    if (ano) filtros.ano = Number(ano);

    const repo = AppDataSource.getRepository(NotasCorte);
    let whereClause: any;

    try {
      // Página de Detalhes
      if (codigo) {
        whereClause = {
          ...filtros,
          codigo_curso: Number(codigo)
        };
      }

      // 2. Busca Global (Home)
      else if (global === 'true' && curso) {
        const query = repo
          .createQueryBuilder("nota")
          .select([
            "nota.curso AS curso",
            "nota.codigo_curso AS codigo_curso",
            "nota.sigla_universidade AS sigla_universidade",
            "nota.nome_universidade AS nome_universidade",
            "nota.uf_campus AS uf_campus",
            "nota.campus AS campus",
            "nota.grau AS grau",
            `${SUM_VAGAS} AS vagas`
          ])
          .where(
            `(
        immutable_unaccent(nota.curso) ILIKE immutable_unaccent(:curso)
        OR nota.sigla_universidade ILIKE :curso
        OR nota.nome_universidade ILIKE :curso
        )`,
            { curso: `%${curso}%` }
          );

        // Filtro padrão de Estado: restringe aos campi da UF escolhida.
        // Precisa dos parênteses acima: sem eles, "A OR B OR C AND D" vira
        // "A OR B OR (C AND D)" (AND tem precedência sobre OR em SQL), e o
        // filtro de estado acaba sendo ignorado sempre que curso ou sigla
        // batem sozinhos.
        if (uf) {
          query.andWhere("nota.uf_campus = :uf", { uf: String(uf).toUpperCase() });
        }

        // Filtro de edição: sem isso, com 2025 e 2026 convivendo na mesma
        // tabela, o SUM(vagas) soma as duas edições juntas.
        if (ano) {
          query.andWhere("nota.ano = :ano", { ano: String(ano) });
        }

        const resultados = await query
          .groupBy("nota.curso")
          .addGroupBy("nota.codigo_curso")
          .addGroupBy("nota.sigla_universidade")
          .addGroupBy("nota.nome_universidade")
          .addGroupBy("nota.uf_campus")
          .addGroupBy("nota.campus")
          .addGroupBy("nota.grau")
          .orderBy("vagas", "DESC")
          .limit(100)
          .getRawMany();

        return respond(resultados);
      }
      // Página de Cursos (apenas curso)
      else if (curso && !universidade) {

        const query = repo
          .createQueryBuilder("nota")
          .select([
            "nota.curso AS curso",
            "nota.codigo_curso AS codigo_curso",
            "nota.sigla_universidade AS sigla_universidade",
            "nota.nome_universidade AS nome_universidade",
            "nota.uf_campus AS uf_campus",
            "nota.campus AS campus",
            "nota.grau AS grau",
            `${SUM_VAGAS} AS vagas`
          ])
          .where("immutable_unaccent(nota.curso) ILIKE immutable_unaccent(:curso)", {
            curso: `%${curso}%`
          });

        if (uf) {
          query.andWhere("nota.uf_campus = :uf", { uf: String(uf).toUpperCase() });
        }
        if (ano) {
          query.andWhere("nota.ano = :ano", { ano: String(ano) });
        }

        const resultados = await query
          .groupBy("nota.curso")
          .addGroupBy("nota.codigo_curso")
          .addGroupBy("nota.sigla_universidade")
          .addGroupBy("nota.nome_universidade")
          .addGroupBy("nota.uf_campus")
          .addGroupBy("nota.campus")
          .addGroupBy("nota.grau")
          .orderBy("vagas", "DESC")
          .limit(100)
          .getRawMany();

        return respond(resultados);
      }
      // Página de Instituições (apenas universidade)
      else if (universidade) {

        const resultados = await repo
          .createQueryBuilder("nota")
          .select([
            "nota.curso AS curso",
            "nota.codigo_curso AS codigo_curso",
            "nota.sigla_universidade AS sigla_universidade",
            "nota.nome_universidade AS nome_universidade",
            "nota.uf_campus AS uf_campus",
            "nota.campus AS campus",
            "nota.grau AS grau",
            `${SUM_VAGAS} AS vagas`
          ])
          .where(
            `
        nota.sigla_universidade ILIKE :universidade
        OR nota.nome_universidade ILIKE :universidade
        `,
            { universidade: `%${universidade}%` }
          )
          .groupBy("nota.curso")
          .addGroupBy("nota.codigo_curso")
          .addGroupBy("nota.sigla_universidade")
          .addGroupBy("nota.nome_universidade")
          .addGroupBy("nota.uf_campus")
          .addGroupBy("nota.campus")
          .addGroupBy("nota.grau")
          .orderBy("nota.curso", "ASC")
          .limit(200)
          .getRawMany();

        return respond(resultados);
      }
      const resultados = await repo.find({
        where: whereClause,
        order: { nota_corte: "DESC" },
        take: 100,
      });

      return respond(resultados);
    } catch (error) {
      console.error("Erro na busca de notas de corte:", error);
      return res.status(500).json({ error: "Erro ao buscar notas de corte" });
    }
  }

  async suggestions(req: Request, res: Response) {
    const { curso, universidade } = req.query;

    if (!curso && !universidade) return res.json([]);

    const cacheKey = `sugestoes:${universidade ? `universidade:${universidade}` : `curso:${curso}`}`;
    const cached = sugestoesCache.get(cacheKey);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.json(cached);
    }

    const repo = AppDataSource.getRepository(NotasCorte);

    try {
      const query = repo.createQueryBuilder("nota");

      if (universidade) {
        // Busca por SIGLA ou NOME da universidade
        const unis = await query
          .select("DISTINCT(nota.sigla_universidade)", "sigla")
          .where("nota.sigla_universidade ILIKE :termo", { termo: `%${universidade}%` })
          .orWhere("nota.nome_universidade ILIKE :termo", { termo: `%${universidade}%` })
          .limit(10)
          .getRawMany();

        const resultado = unis.map(u => u.sigla);
        sugestoesCache.set(cacheKey, resultado);
        res.setHeader("X-Cache", "MISS");
        return res.json(resultado);
      }

      if (curso) {
        // Busca por NOME do curso (com unaccent)
        const cursos = await query
          .select("DISTINCT(nota.curso)", "curso")
          .where("immutable_unaccent(nota.curso) ILIKE immutable_unaccent(:termo)", { termo: `%${curso}%` })
          .limit(10)
          .getRawMany();

        const resultado = cursos.map(c => c.curso);
        sugestoesCache.set(cacheKey, resultado);
        res.setHeader("X-Cache", "MISS");
        return res.json(resultado);
      }

    } catch (error) {
      console.error("Erro no Banco:", error);
      return res.status(500).json({ error: "Erro ao buscar sugestões" });
    }
  }
}
