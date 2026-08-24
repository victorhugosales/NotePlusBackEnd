# NotePlus - Backend

> API REST inteligente para processamento e análise estratégica de dados do SISU.

# Contextualização do Projeto

O **NotePlus+ Backend** é a camada de inteligência e processamento de dados da plataforma, desenvolvida para sustentar o ecossistema de análise de notas de corte do Sistema de Seleção Unificada (SISU).

A arquitetura foi projetada para resolver o problema de manipulação de microdados públicos e planilhas complexas (como arquivos `.xlsx` do MEC/INEP), centralizando e tratando essas informações em um banco de dados estruturado. A API expõe endpoints otimizados que alimentam a interface pública, permitindo consultas rápidas, filtros avançados e cálculos estatísticos em tempo real para mitigar a volatilidade das notas.

O desenvolvimento foi guiado por princípios de engenharia de software para garantir escalabilidade, integridade dos dados históricos e segurança na comunicação com o cliente.

---

# Funcionalidades e Responsabilidades da API

O ecossistema do backend foi construído para fornecer uma base sólida de dados educacionais, respondendo por:

- **Processamento e ETL:** Importação, limpeza e segmentação de microdados oficiais do SISU/INEP por instituição, campus, curso e modalidade.
- **Cálculos Estatísticos (Estatística Descritiva):** Implementação de lógica para calcular Média Aritmética, Moda e Mediana das notas históricas para identificar padrões de aprovação.
- **Endpoints de Busca Avançada:** Filtros dinâmicos que viabilizam a comparação imediata entre ampla concorrência (AC) e o sistema de cotas (Lei nº 12.711/2012).
- **Agregação Histórica:** Estruturação de dados interanuais para permitir que a interface trace gráficos de tendências e evolução das notas.

---

# Stack Tecnológica

O ecossistema do backend e persistência foi desenhado utilizando ferramentas modernas do ecossistema JavaScript/TypeScript para garantir tipagem estática e segurança em tempo de desenvolvimento.

## Core do Server
- **Node.js**
- **TypeScript:** Garante maior manutenibilidade e contratos claros na estrutura de dados da API.

## Persistência e ORM
- **TypeORM:** Utilizado como mapeador objeto-relacional para gerenciar migrações, entidades e relacionamentos complexos de forma idiomática.
- **PostgreSQL:** Banco de dados relacional que hospeda o volume de microdados e histórico do SISU com alta performance de leitura.

---

# Links do Ambiente

A API possui esteiras independentes para garantir a estabilidade do fluxo de desenvolvimento:
💻 **Frontend Integrado:** [https://note-plus-bay.vercel.app/](https://note-plus-bay.vercel.app/)
---

# Objetivos de Engenharia (Backend)

No escopo de backend, o desenvolvimento do NotePlus+ foca em consolidar boas práticas de arquitetura de software:

- **Modelagem Relacional Eficiente:** Normalização de tabelas para representar a hierarquia real do SISU (Instituição ➔ Campus ➔ Curso ➔ Modalidades ➔ Notas).
- **Abstração com ORM:** Uso avançado de Repositories e Query Builders do TypeORM para otimizar consultas pesadas de agregação de dados.
- **Separação de Conceitos (SoC):** Divisão clara entre Controllers (rotas), Services (regras de negócio e estatística) e Data Access (repositórios).

---

# Evolução Planejada

Para as próximas iterações da API, estão previstas:

- Mecanismo automatizado de ingestão/parse de novos arquivos `.xlsx` do Portal Único de Acesso.
- Criação de endpoints preditivos utilizando algoritmos simples de tendência para simular notas futuras.
- Implementação de camadas de *caching* (como Redis) para os endpoints de estatísticas históricas mais acessados.
- Integração direta com APIs governamentais caso fiquem disponíveis.

---

# Autor

Projeto desenvolvido por **Victor Hugo Sales Paz** , acadêmico de Análise e Desenvolvimento de Sistemas na Faculdade Princesa do Oeste.
