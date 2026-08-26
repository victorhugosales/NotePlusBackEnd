import { LRUCache } from "lru-cache";

// Cache em memória do próprio processo. Justificativa: o backend roda como
// uma única instância no Render, então não há necessidade de um cache
// compartilhado (Redis) por enquanto — isso fica documentado como evolução
// futura para quando houver múltiplas instâncias.

// /stats: dado caro (3 COUNT(DISTINCT) na tabela inteira) e que só muda
// quando uma nova edição do SISU é importada. Uma única chave, TTL longo.
export const statsCache = new LRUCache<string, any>({
  max: 1,
  ttl: 1000 * 60 * 30, // 30 minutos
});
export const STATS_CACHE_KEY = "dashboard-stats";

// /sugestoes: autocomplete, dispara a cada tecla digitada. Muitos usuários
// repetem os mesmos prefixos ("eng", "medi", "dire"...). TTL curto.
export const sugestoesCache = new LRUCache<string, any>({
  max: 500,
  ttl: 1000 * 60 * 10, // 10 minutos
});

// /pesquisar: muitas combinações de filtro possíveis, mas a maioria do
// tráfego se concentra em poucos cursos/instituições populares. LRU limitado
// em tamanho evita crescer sem controle; TTL curto porque o resultado
// depende de múltiplos parâmetros combinados.
export const pesquisaCache = new LRUCache<string, any>({
  max: 200,
  ttl: 1000 * 60 * 5, // 5 minutos
});

// /anos-disponiveis: lista de EDICAO distintas na tabela — usada pelo front
// pra montar os seletores de ano dinamicamente (nada de lista fixa no
// código). Mesmo padrão do statsCache: só muda quando uma importação roda,
// e ImportacaoController.confirmar invalida essa chave (e a de stats) assim
// que uma importação é confirmada, pra não esperar os 30 minutos de TTL.
export const anosCache = new LRUCache<string, any>({
  max: 1,
  ttl: 1000 * 60 * 30, // 30 minutos
});
export const ANOS_CACHE_KEY = "anos-disponiveis";

// Listas completas para os filtros em cascata da Home (estado -> município
// ou instituição -> cursos). Mesmo racional do anosCache: mudam só quando
// uma importação roda, TTL longo. Chave inclui os parâmetros (ano, uf)
// porque cada combinação tem sua própria lista.
export const estadosCache = new LRUCache<string, any>({
  max: 20, // poucas edições do SISU convivem na tabela ao mesmo tempo
  ttl: 1000 * 60 * 30,
});
export const municipiosCache = new LRUCache<string, any>({
  max: 200, // 27 UFs x poucas edições
  ttl: 1000 * 60 * 30,
});
export const instituicoesCache = new LRUCache<string, any>({
  max: 200,
  ttl: 1000 * 60 * 30,
});
export const cursosCache = new LRUCache<string, any>({
  max: 20,
  ttl: 1000 * 60 * 30,
});

// Filtros de Turno e Grau da página de Cursos. Mesmo racional do
// cursosCache: poucos valores distintos, um por edição do SISU.
export const turnosCache = new LRUCache<string, any>({
  max: 20,
  ttl: 1000 * 60 * 30,
});
export const grausCache = new LRUCache<string, any>({
  max: 20,
  ttl: 1000 * 60 * 30,
});

// Filtro de Categoria Administrativa (Federal/Estadual/Municipal) da
// página de Faculdades. Mesmo racional do turnosCache/grausCache.
export const categoriasCache = new LRUCache<string, any>({
  max: 20,
  ttl: 1000 * 60 * 30,
});
