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
