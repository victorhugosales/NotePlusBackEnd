import { Request, Response } from "express";
import { AppDataSource } from "../database/datasource";
import { NotasCorte } from "../Entities/NotasCorte";
import { Like, ILike, Raw } from "typeorm";
import {
  pesquisaCache, sugestoesCache, statsCache, STATS_CACHE_KEY, anosCache, ANOS_CACHE_KEY,
  estadosCache, municipiosCache, instituicoesCache, cursosCache,
} from "../cache/searchCache";

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
    const { curso, universidade, cidade, ano, global, codigo, uf, turno } = req.query;
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
    // Sem turno informado, a página de Detalhes mostra todos os turnos
    // juntos (compatível com links antigos); com turno, filtra só aquele.
    if (turno) filtros.turno = turno;

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
            "nota.turno AS turno",
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
          .addGroupBy("nota.turno")
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
            "nota.turno AS turno",
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
          .addGroupBy("nota.turno")
          .orderBy("vagas", "DESC")
          .limit(100)
          .getRawMany();

        return respond(resultados);
      }
      // Página de Instituições (apenas universidade)
      else if (universidade) {

        const resultadosQuery = repo
          .createQueryBuilder("nota")
          .select([
            "nota.curso AS curso",
            "nota.codigo_curso AS codigo_curso",
            "nota.sigla_universidade AS sigla_universidade",
            "nota.nome_universidade AS nome_universidade",
            "nota.uf_campus AS uf_campus",
            "nota.campus AS campus",
            "nota.grau AS grau",
            "nota.turno AS turno",
            `${SUM_VAGAS} AS vagas`
          ])
          .where(
            `(
        nota.sigla_universidade ILIKE :universidade
        OR nota.nome_universidade ILIKE :universidade
        )`,
            { universidade: `%${universidade}%` }
          );

        // Precisa dos parênteses acima: sem eles, "A OR B AND ano" vira
        // "A OR (B AND ano)" (AND tem precedência sobre OR em SQL) — o
        // filtro de ano seria ignorado sempre que a sigla batesse sozinha
        // (mesmo cuidado já tomado no branch "global" abaixo). Sem isso,
        // com 2024/2025/2026 convivendo na mesma tabela, os resultados de
        // uma instituição misturariam edições diferentes do SISU.
        if (ano) {
          resultadosQuery.andWhere("nota.ano = :ano", { ano: String(ano) });
        }

        const resultados = await resultadosQuery
          .groupBy("nota.curso")
          .addGroupBy("nota.codigo_curso")
          .addGroupBy("nota.sigla_universidade")
          .addGroupBy("nota.nome_universidade")
          .addGroupBy("nota.uf_campus")
          .addGroupBy("nota.campus")
          .addGroupBy("nota.grau")
          .addGroupBy("nota.turno")
          .orderBy("nota.curso", "ASC")
          .limit(200)
          .getRawMany();

        return respond(resultados);
      }
      // Filtro por município (modal em cascata da Home: estado -> município
      // -> cursos oferecidos ali). Igualdade exata, não ILIKE: o valor vem
      // direto de /municipios-disponiveis, não é digitado pelo usuário.
      else if (cidade) {
        const query = repo
          .createQueryBuilder("nota")
          .select([
            "nota.curso AS curso",
            "nota.codigo_curso AS codigo_curso",
            "nota.sigla_universidade AS sigla_universidade",
            "nota.nome_universidade AS nome_universidade",
            "nota.uf_campus AS uf_campus",
            "nota.cidade AS cidade",
            "nota.campus AS campus",
            "nota.grau AS grau",
            "nota.turno AS turno",
            `${SUM_VAGAS} AS vagas`
          ])
          .where("nota.cidade = :cidade", { cidade: String(cidade) });

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
          .addGroupBy("nota.cidade")
          .addGroupBy("nota.campus")
          .addGroupBy("nota.grau")
          .addGroupBy("nota.turno")
          .orderBy("vagas", "DESC")
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

  // Listas completas (não autocomplete, sem limit) para os filtros em
  // cascata da Home: estado -> município/instituição -> cursos. Diferente
  // de /sugestoes, não exigem termo de busca.

  async estadosDisponiveis(req: Request, res: Response) {
    const { ano } = req.query;
    const cacheKey = `estados:${ano || "todos"}`;
    const cached = estadosCache.get(cacheKey);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.json(cached);
    }

    try {
      const query = AppDataSource.getRepository(NotasCorte)
        .createQueryBuilder("nota")
        .select("DISTINCT nota.uf_campus", "uf");
      if (ano) query.andWhere("nota.ano = :ano", { ano: String(ano) });

      const linhas = await query.orderBy("nota.uf_campus", "ASC").getRawMany();
      const estados = linhas.map((l) => l.uf).filter(Boolean);

      estadosCache.set(cacheKey, estados);
      res.setHeader("X-Cache", "MISS");
      return res.json(estados);
    } catch (error) {
      console.error("Erro no Banco:", error);
      return res.status(500).json({ error: "Erro ao buscar estados disponíveis" });
    }
  }

  async municipiosDisponiveis(req: Request, res: Response) {
    const { uf, ano } = req.query;
    if (!uf) return res.status(400).json({ error: "Informe o parâmetro uf" });

    const cacheKey = `municipios:${String(uf).toUpperCase()}:${ano || "todos"}`;
    const cached = municipiosCache.get(cacheKey);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.json(cached);
    }

    try {
      const query = AppDataSource.getRepository(NotasCorte)
        .createQueryBuilder("nota")
        .select("DISTINCT nota.cidade", "municipio")
        .where("nota.uf_campus = :uf", { uf: String(uf).toUpperCase() });
      if (ano) query.andWhere("nota.ano = :ano", { ano: String(ano) });

      const linhas = await query.orderBy("nota.cidade", "ASC").getRawMany();
      const municipios = linhas.map((l) => l.municipio).filter(Boolean);

      municipiosCache.set(cacheKey, municipios);
      res.setHeader("X-Cache", "MISS");
      return res.json(municipios);
    } catch (error) {
      console.error("Erro no Banco:", error);
      return res.status(500).json({ error: "Erro ao buscar municípios disponíveis" });
    }
  }

  async instituicoesDisponiveis(req: Request, res: Response) {
    const { uf, ano } = req.query;
    if (!uf) return res.status(400).json({ error: "Informe o parâmetro uf" });

    const cacheKey = `instituicoes:${String(uf).toUpperCase()}:${ano || "todos"}`;
    const cached = instituicoesCache.get(cacheKey);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.json(cached);
    }

    try {
      const query = AppDataSource.getRepository(NotasCorte)
        .createQueryBuilder("nota")
        .select(["DISTINCT nota.nome_universidade AS nome", "nota.sigla_universidade AS sigla"])
        .where("nota.uf_campus = :uf", { uf: String(uf).toUpperCase() });
      if (ano) query.andWhere("nota.ano = :ano", { ano: String(ano) });

      const linhas = await query.orderBy("nota.nome_universidade", "ASC").getRawMany();
      const instituicoes = linhas.map((l) => ({ nome: l.nome, sigla: l.sigla })).filter((i) => i.nome);

      instituicoesCache.set(cacheKey, instituicoes);
      res.setHeader("X-Cache", "MISS");
      return res.json(instituicoes);
    } catch (error) {
      console.error("Erro no Banco:", error);
      return res.status(500).json({ error: "Erro ao buscar instituições disponíveis" });
    }
  }

  async cursosDisponiveis(req: Request, res: Response) {
    const { ano } = req.query;
    const cacheKey = `cursos:${ano || "todos"}`;
    const cached = cursosCache.get(cacheKey);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.json(cached);
    }

    try {
      const query = AppDataSource.getRepository(NotasCorte)
        .createQueryBuilder("nota")
        .select("DISTINCT nota.curso", "curso");
      if (ano) query.andWhere("nota.ano = :ano", { ano: String(ano) });

      const linhas = await query.orderBy("nota.curso", "ASC").getRawMany();
      const cursos = linhas.map((l) => l.curso).filter(Boolean);

      cursosCache.set(cacheKey, cursos);
      res.setHeader("X-Cache", "MISS");
      return res.json(cursos);
    } catch (error) {
      console.error("Erro no Banco:", error);
      return res.status(500).json({ error: "Erro ao buscar cursos disponíveis" });
    }
  }

  // Edições do SISU com dados no banco, mais recente primeiro. O front usa
  // isso pra montar os seletores de ano dinamicamente — nada fica fixo no
  // código, então uma edição nova (ou antiga) aparece assim que for
  // importada, sem precisar tocar em nenhuma tela.
  async anosDisponiveis(_req: Request, res: Response) {
    const cached = anosCache.get(ANOS_CACHE_KEY);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.json(cached);
    }

    try {
      const linhas = await AppDataSource.getRepository(NotasCorte)
        .createQueryBuilder("nota")
        .select("DISTINCT nota.ano", "ano")
        .orderBy("nota.ano", "DESC")
        .getRawMany();

      const anos = linhas.map((l) => Number(l.ano));
      anosCache.set(ANOS_CACHE_KEY, anos);
      res.setHeader("X-Cache", "MISS");
      return res.json(anos);
    } catch (error) {
      console.error("Erro no Banco:", error);
      return res.status(500).json({ error: "Erro ao buscar anos disponíveis" });
    }
  }
}
