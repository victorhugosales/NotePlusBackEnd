import { Request, Response } from "express";
import { AppDataSource } from "../database/datasource";
import { NotasCorte } from "../Entities/NotasCorte";
import { Favorito } from "../Entities/Favorito";
import { Like, ILike, Raw, Brackets } from "typeorm";
import {
  pesquisaCache, sugestoesCache, statsCache, STATS_CACHE_KEY, anosCache, ANOS_CACHE_KEY,
  estadosCache, municipiosCache, instituicoesCache, cursosCache, turnosCache, grausCache, categoriasCache,
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
const VAGAS_NUMERICAS = `NULLIF(nota."QT_VAGAS_OFERTADAS"::text, '')::numeric`;
const SUM_VAGAS = `SUM(${VAGAS_NUMERICAS})`;

// Mesmo problema, mesma solução: NU_NOTACORTE também não é numeric em todo
// ambiente (varchar em alguns), e comparar/ordenar direto (`nota_corte > 0`)
// quebra com "operator does not exist: character varying > integer". Troca
// vírgula por ponto antes do cast — o transformer da entity já faz isso no
// lado do JS (repo.find), mas aqui é SQL cru (getRawMany), então precisa
// replicar. Usada tanto pra comparar/ordenar quanto pro valor que volta pro
// front (sem isso "938,25" vira NaN em Number() lá).
const NOTA_CORTE_NUMERICA = `NULLIF(REPLACE(nota."NU_NOTACORTE"::text, ',', '.'), '')::numeric`;

// Modalidade usada pelos cards de "destaque" da Home (Maiores/Menores
// Notas, Mais Ofertados, Mais Procurados): é a única modalidade que existe
// pra praticamente todo curso/campus, então é a única em que comparar nota
// de corte entre ofertas diferentes faz sentido — as demais são cotas com
// critérios próprios (renda, PCD, etc.), não comparáveis entre si.
const MODALIDADE_AMPLA_CONCORRENCIA = "AC";

export class NotasCorteController {
  async search(req: Request, res: Response) {
    const { curso, universidade, cidade, ano, global, codigo, uf, turno, grau, categoria, exato, destaque } = req.query;
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

      // Cards de "Destaque" da Home (Mais Procurados / Maiores Notas /
      // Mais Ofertados / Mais Possibilidades) — sem termo de busca, só
      // listas prontas a partir de um critério de ordenação.
      else if (destaque) {
        const colunasDestaque = [
          "nota.curso AS curso",
          "nota.codigo_curso AS codigo_curso",
          "nota.sigla_universidade AS sigla_universidade",
          "nota.nome_universidade AS nome_universidade",
          "nota.uf_campus AS uf_campus",
          "nota.cidade AS cidade",
          "nota.campus AS campus",
          "nota.grau AS grau",
          "nota.turno AS turno",
          `${NOTA_CORTE_NUMERICA} AS nota_corte`,
          `${VAGAS_NUMERICAS} AS vagas`
        ];

        // "Mais Procurados": não existe rastreio de quantas vezes um curso
        // foi pesquisado, então usamos o único sinal de popularidade que já
        // existe no banco — quantos usuários favoritaram cada curso.
        if (destaque === 'mais-procurados') {
          const ranking = await AppDataSource.getRepository(Favorito)
            .createQueryBuilder("fav")
            .select(["fav.codigo_curso AS codigo_curso", "fav.sigla_universidade AS sigla_universidade", "COUNT(*) AS total"])
            .groupBy("fav.codigo_curso")
            .addGroupBy("fav.sigla_universidade")
            .orderBy("total", "DESC")
            .limit(30)
            .getRawMany();

          if (ranking.length === 0) return respond([]);

          const query = repo
            .createQueryBuilder("nota")
            .select(colunasDestaque)
            .where("nota.modalidade = :modalidade", { modalidade: MODALIDADE_AMPLA_CONCORRENCIA })
            .andWhere(new Brackets((qb) => {
              ranking.forEach((item, i) => {
                const condicao = `(nota.codigo_curso = :cod${i} AND nota.sigla_universidade = :uni${i})`;
                const parametros = { [`cod${i}`]: item.codigo_curso, [`uni${i}`]: item.sigla_universidade };
                if (i === 0) qb.where(condicao, parametros);
                else qb.orWhere(condicao, parametros);
              });
            }));

          if (ano) query.andWhere("nota.ano = :ano", { ano: Number(ano) });
          if (uf) query.andWhere("nota.uf_campus = :uf", { uf: String(uf).toUpperCase() });

          const linhas: any[] = await query.getRawMany();

          // A query acima não preserva a ordem do ranking de favoritos —
          // reordena pelo mesmo critério antes de responder.
          const posicao = new Map(ranking.map((item, i) => [`${item.codigo_curso}-${item.sigla_universidade}`, i]));
          linhas.sort((a, b) =>
            (posicao.get(`${a.codigo_curso}-${a.sigla_universidade}`) ?? 0) -
            (posicao.get(`${b.codigo_curso}-${b.sigla_universidade}`) ?? 0)
          );

          return respond(linhas);
        }

        const ordenacoes: Record<string, { coluna: string; direcao: "ASC" | "DESC" }> = {
          'maiores-notas': { coluna: "nota_corte", direcao: "DESC" },
          'menores-notas': { coluna: "nota_corte", direcao: "ASC" },
          'mais-ofertados': { coluna: "vagas", direcao: "DESC" },
        };
        const config = ordenacoes[String(destaque)];
        if (!config) return respond([]);

        const query = repo
          .createQueryBuilder("nota")
          .select(colunasDestaque)
          .where("nota.modalidade = :modalidade", { modalidade: MODALIDADE_AMPLA_CONCORRENCIA });

        // 0 aqui é "sem nota de corte registrada" (transformer da entidade
        // trata vazio como 0), não uma nota real — sem esse filtro, essas
        // linhas dominariam o topo de Maiores/Menores Notas.
        if (destaque !== 'mais-ofertados') query.andWhere(`${NOTA_CORTE_NUMERICA} > 0`);

        if (ano) query.andWhere("nota.ano = :ano", { ano: Number(ano) });
        if (uf) query.andWhere("nota.uf_campus = :uf", { uf: String(uf).toUpperCase() });

        const resultados = await query
          .orderBy(config.coluna, config.direcao)
          .limit(30)
          .getRawMany();

        return respond(resultados);
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
        // Filtros de Turno e Grau da página de Cursos — igualdade exata: os
        // valores vêm de /turnos-disponiveis e /graus-disponiveis, não são
        // digitados pelo usuário.
        if (turno) {
          query.andWhere("nota.turno = :turno", { turno: String(turno) });
        }
        if (grau) {
          query.andWhere("nota.grau = :grau", { grau: String(grau) });
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

        // Selecionou uma sugestão do autocomplete (sigla ou nome exatos, já
        // confirmados por /sugestoes) em vez de digitar livre: troca ILIKE
        // por igualdade exata. Sem isso, "UFC" batia em ILIKE '%UFC%' e
        // trazia junto UFCA, UFCAT, UFCG, UFCSPA — resultado maior que o
        // necessário pra quem já escolheu a instituição certa na lista.
        const buscaExata = exato === "true";

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
            "nota.categoria_administrativa AS categoria_administrativa",
            `${SUM_VAGAS} AS vagas`
          ])
          .where(
            buscaExata
              ? `(
        nota.sigla_universidade = :universidade
        OR nota.nome_universidade = :universidade
        )`
              : `(
        nota.sigla_universidade ILIKE :universidade
        OR nota.nome_universidade ILIKE :universidade
        )`,
            { universidade: buscaExata ? String(universidade) : `%${universidade}%` }
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
        // Filtros "Estado" e "Categoria" da página de Faculdades.
        if (uf) {
          resultadosQuery.andWhere("nota.uf_campus = :uf", { uf: String(uf).toUpperCase() });
        }
        if (categoria) {
          resultadosQuery.andWhere("nota.categoria_administrativa = :categoria", { categoria: String(categoria) });
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
          .addGroupBy("nota.categoria_administrativa")
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

  // Turnos e graus distintos — filtros da página de Cursos. Mesmo padrão de
  // /cursos-disponiveis: sem termo de busca, lista completa cacheada.
  async turnosDisponiveis(req: Request, res: Response) {
    const { ano } = req.query;
    const cacheKey = `turnos:${ano || "todos"}`;
    const cached = turnosCache.get(cacheKey);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.json(cached);
    }

    try {
      const query = AppDataSource.getRepository(NotasCorte)
        .createQueryBuilder("nota")
        .select("DISTINCT nota.turno", "turno");
      if (ano) query.andWhere("nota.ano = :ano", { ano: String(ano) });

      const linhas = await query.orderBy("nota.turno", "ASC").getRawMany();
      const turnos = linhas.map((l) => l.turno).filter(Boolean);

      turnosCache.set(cacheKey, turnos);
      res.setHeader("X-Cache", "MISS");
      return res.json(turnos);
    } catch (error) {
      console.error("Erro no Banco:", error);
      return res.status(500).json({ error: "Erro ao buscar turnos disponíveis" });
    }
  }

  async grausDisponiveis(req: Request, res: Response) {
    const { ano } = req.query;
    const cacheKey = `graus:${ano || "todos"}`;
    const cached = grausCache.get(cacheKey);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.json(cached);
    }

    try {
      const query = AppDataSource.getRepository(NotasCorte)
        .createQueryBuilder("nota")
        .select("DISTINCT nota.grau", "grau");
      if (ano) query.andWhere("nota.ano = :ano", { ano: String(ano) });

      const linhas = await query.orderBy("nota.grau", "ASC").getRawMany();
      const graus = linhas.map((l) => l.grau).filter(Boolean);

      grausCache.set(cacheKey, graus);
      res.setHeader("X-Cache", "MISS");
      return res.json(graus);
    } catch (error) {
      console.error("Erro no Banco:", error);
      return res.status(500).json({ error: "Erro ao buscar graus disponíveis" });
    }
  }

  // Categoria administrativa distinta — filtro "Categoria" da página de
  // Faculdades. Mesmo padrão de /turnos-disponiveis e /graus-disponiveis.
  async categoriasDisponiveis(req: Request, res: Response) {
    const { ano } = req.query;
    const cacheKey = `categorias:${ano || "todos"}`;
    const cached = categoriasCache.get(cacheKey);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.json(cached);
    }

    try {
      const query = AppDataSource.getRepository(NotasCorte)
        .createQueryBuilder("nota")
        .select("DISTINCT nota.categoria_administrativa", "categoria");
      if (ano) query.andWhere("nota.ano = :ano", { ano: String(ano) });

      const linhas = await query.orderBy("nota.categoria_administrativa", "ASC").getRawMany();
      const categorias = linhas.map((l) => l.categoria).filter(Boolean);

      categoriasCache.set(cacheKey, categorias);
      res.setHeader("X-Cache", "MISS");
      return res.json(categorias);
    } catch (error) {
      console.error("Erro no Banco:", error);
      return res.status(500).json({ error: "Erro ao buscar categorias disponíveis" });
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
