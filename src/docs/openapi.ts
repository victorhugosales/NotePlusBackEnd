// Especificação OpenAPI 3.0 escrita à mão (em vez de swagger-jsdoc lendo
// comentários espalhados pelos controllers) — mais fácil de manter e revisar
// num arquivo só, dado o tamanho atual da API. Servida via swagger-ui-express
// em /docs (ver src/docs/swagger.ts).

export const openApiSpec = {
    openapi: "3.0.3",
    info: {
        title: "NotePlus+ API",
        version: "1.0.0",
        description:
            "API do NotePlus+ — consulta de notas de corte do SISU, autenticação, perfil de candidato, favoritos e notificações.",
    },
    servers: [{ url: "/", description: "Servidor atual" }],
    tags: [
        { name: "Notas de Corte", description: "Busca pública de cursos, universidades e notas de corte" },
        { name: "Autenticação", description: "Login e cadastro" },
        { name: "Usuário", description: "Perfil do usuário logado" },
        { name: "Favoritos", description: "Cursos favoritados pelo usuário logado" },
        { name: "Notificações", description: "Notificações do usuário logado" },
        { name: "Admin", description: "Área restrita a administradores — importação de planilhas de notas de corte" },
    ],
    components: {
        securitySchemes: {
            bearerAuth: {
                type: "http",
                scheme: "bearer",
                bearerFormat: "JWT",
                description: 'Envie o token retornado por /login ou /usuarios no header: "Authorization: Bearer <token>"',
            },
        },
        schemas: {
            Erro: {
                type: "object",
                properties: { error: { type: "string" } },
            },
            NotaCorte: {
                type: "object",
                description: "Uma linha de nota de corte (um curso, numa universidade, numa modalidade, numa edição do SISU).",
                properties: {
                    id_projeto: { type: "integer" },
                    codigo_instituicao: { type: "integer" },
                    ano: { type: "integer", example: 2026 },
                    nome_universidade: { type: "string" },
                    sigla_universidade: { type: "string", example: "UFC" },
                    uf_campus: { type: "string", example: "CE" },
                    campus: { type: "string" },
                    cidade: { type: "string" },
                    codigo_curso: { type: "integer" },
                    curso: { type: "string" },
                    turno: { type: "string", nullable: true, example: "Matutino" },
                    modalidade: { type: "string", example: "AC" },
                    descricao_cota: { type: "string" },
                    vagas: { type: "number" },
                    inscritos: { type: "number" },
                    grau: { type: "string", example: "Bacharelado" },
                    nota_corte: { type: "number", example: 699.6 },
                },
            },
            Usuario: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    nome: { type: "string" },
                    email: { type: "string" },
                    avatar_url: { type: "string", nullable: true },
                    buscas_realizadas: { type: "integer" },
                    limite_buscas: { type: "integer" },
                    nota_enem: { type: "number", nullable: true },
                    modalidades: { type: "array", items: { type: "string" }, nullable: true },
                    configuracoes: {
                        type: "object",
                        nullable: true,
                        properties: {
                            tema: { type: "string", enum: ["light", "dark"] },
                            idioma: { type: "string" },
                            notif_cursos: { type: "boolean" },
                            notif_atualizacoes: { type: "boolean" },
                            notif_mensagens: { type: "boolean" },
                            efeitos_sonoros: { type: "boolean" },
                            animacoes: { type: "boolean" },
                        },
                    },
                },
            },
            Favorito: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    usuario_id: { type: "integer" },
                    codigo_curso: { type: "integer" },
                    sigla_universidade: { type: "string" },
                    curso: { type: "string" },
                    nome_universidade: { type: "string", nullable: true },
                    uf_campus: { type: "string", nullable: true },
                    campus: { type: "string", nullable: true },
                    grau: { type: "string", nullable: true },
                    created_at: { type: "string", format: "date-time" },
                },
            },
            Notificacao: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    usuario_id: { type: "integer" },
                    tipo: { type: "string", enum: ["curso_em_alta", "curso_similar_favorito"] },
                    titulo: { type: "string" },
                    mensagem: { type: "string" },
                    lida: { type: "boolean" },
                    created_at: { type: "string", format: "date-time" },
                },
            },
        },
        responses: {
            NaoAutorizado: {
                description: "Token ausente, inválido ou expirado",
                content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } },
            },
            MuitasRequisicoes: {
                description: "Limite de requisições por IP excedido (rate limit)",
                content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } },
            },
        },
    },
    paths: {
        "/pesquisar": {
            get: {
                tags: ["Notas de Corte"],
                summary: "Busca notas de corte (Home, Cursos, Faculdades ou Detalhes, conforme os parâmetros enviados)",
                description:
                    "Endpoint único com 4 comportamentos: `codigo` presente → detalhes de um curso específico; `global=true`+`curso` → busca geral (Home); `curso` sozinho → busca por curso (aba Cursos); `universidade` sozinho → busca por instituição (aba Faculdades).",
                parameters: [
                    { name: "curso", in: "query", schema: { type: "string" }, description: "Nome (parcial) do curso" },
                    { name: "universidade", in: "query", schema: { type: "string" }, description: "Sigla ou nome (parcial) da universidade" },
                    { name: "codigo", in: "query", schema: { type: "integer" }, description: "Código do curso (página de Detalhes)" },
                    { name: "global", in: "query", schema: { type: "boolean" }, description: "true = busca geral (Home)" },
                    { name: "ano", in: "query", schema: { type: "integer" }, example: 2026 },
                    { name: "uf", in: "query", schema: { type: "string" }, example: "CE" },
                    { name: "turno", in: "query", schema: { type: "string" }, description: "Só usado junto com `codigo`" },
                    { name: "cidade", in: "query", schema: { type: "string" } },
                ],
                responses: {
                    200: {
                        description: "Lista de notas de corte (agregadas ou não, dependendo do modo de busca)",
                        content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/NotaCorte" } } } },
                    },
                    429: { $ref: "#/components/responses/MuitasRequisicoes" },
                },
            },
        },
        "/sugestoes": {
            get: {
                tags: ["Notas de Corte"],
                summary: "Autocomplete de curso ou universidade",
                parameters: [
                    { name: "curso", in: "query", schema: { type: "string" } },
                    { name: "universidade", in: "query", schema: { type: "string" } },
                ],
                responses: {
                    200: {
                        description: "Até 10 sugestões (nomes de curso ou siglas de universidade)",
                        content: { "application/json": { schema: { type: "array", items: { type: "string" } } } },
                    },
                    429: { $ref: "#/components/responses/MuitasRequisicoes" },
                },
            },
        },
        "/stats": {
            get: {
                tags: ["Notas de Corte"],
                summary: "Estatísticas gerais para o dashboard da Home",
                responses: {
                    200: {
                        description: "Contagens agregadas",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        totalCursos: { type: "integer" },
                                        totalFaculdades: { type: "integer" },
                                        totalEstados: { type: "integer" },
                                        mediaCursos: { type: "string", example: "5.0" },
                                    },
                                },
                            },
                        },
                    },
                    429: { $ref: "#/components/responses/MuitasRequisicoes" },
                },
            },
        },
        "/anos-disponiveis": {
            get: {
                tags: ["Notas de Corte"],
                summary: "Edições do SISU com dados no banco, mais recente primeiro",
                description: "Usado pelo front pra montar os seletores de ano dinamicamente — reflete o que foi importado, sem lista fixa no código.",
                responses: {
                    200: {
                        description: "Lista de anos",
                        content: { "application/json": { schema: { type: "array", items: { type: "integer" }, example: [2026, 2025, 2024] } } },
                    },
                    429: { $ref: "#/components/responses/MuitasRequisicoes" },
                },
            },
        },
        "/login": {
            post: {
                tags: ["Autenticação"],
                summary: "Login com e-mail e senha",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["email", "senha"],
                                properties: { email: { type: "string" }, senha: { type: "string" } },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: "Login bem-sucedido",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        token: { type: "string" },
                                        user: {
                                            type: "object",
                                            properties: {
                                                id: { type: "integer" },
                                                nome: { type: "string" },
                                                email: { type: "string" },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    400: { description: "E-mail ou senha não informados", content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } } },
                    401: { description: "E-mail não cadastrado ou senha incorreta", content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } } },
                    429: { $ref: "#/components/responses/MuitasRequisicoes" },
                },
            },
        },
        "/login/google": {
            post: {
                tags: ["Autenticação"],
                summary: "Login/cadastro via Google (Google Identity Services)",
                description:
                    "Recebe o `credential` (ID token JWT) devolvido pelo Google Identity Services no navegador. Valida a assinatura e a audiência contra GOOGLE_CLIENT_ID, sem precisar de client secret. Se o e-mail já existir, faz login (linkando a conta Google); senão, cria uma conta nova sem senha.",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["credential"],
                                properties: { credential: { type: "string", description: "ID token JWT do Google" } },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: "Autenticado com sucesso",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        token: { type: "string" },
                                        user: {
                                            type: "object",
                                            properties: {
                                                id: { type: "integer" },
                                                nome: { type: "string" },
                                                email: { type: "string" },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    400: { description: "credential não informado, ou GOOGLE_CLIENT_ID não configurado no servidor", content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } } },
                    401: { description: "Token do Google inválido/expirado, ou e-mail não verificado", content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } } },
                    429: { $ref: "#/components/responses/MuitasRequisicoes" },
                },
            },
        },
        "/recuperar-senha": {
            post: {
                tags: ["Autenticação"],
                summary: "Solicita redefinição de senha",
                description:
                    "Gera um token de redefinição (válido por 1h) e envia por e-mail via Resend. Sempre responde com a mesma mensagem genérica, exista ou não conta com esse e-mail — evita enumeração de contas cadastradas.",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["email"],
                                properties: { email: { type: "string" } },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: "Solicitação processada (não indica se o e-mail existe)",
                        content: {
                            "application/json": {
                                schema: { type: "object", properties: { message: { type: "string" } } },
                            },
                        },
                    },
                    400: { description: "E-mail não informado", content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } } },
                    429: { $ref: "#/components/responses/MuitasRequisicoes" },
                },
            },
        },
        "/redefinir-senha": {
            post: {
                tags: ["Autenticação"],
                summary: "Redefine a senha usando o token recebido por e-mail",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["token", "novaSenha"],
                                properties: {
                                    token: { type: "string", description: "Token recebido no link do e-mail" },
                                    novaSenha: { type: "string", description: "Mínimo 8 caracteres, com letras e números" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: "Senha redefinida com sucesso",
                        content: {
                            "application/json": {
                                schema: { type: "object", properties: { message: { type: "string" } } },
                            },
                        },
                    },
                    400: { description: "Token inválido/expirado, ou senha fora do padrão exigido", content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } } },
                    429: { $ref: "#/components/responses/MuitasRequisicoes" },
                },
            },
        },
        "/usuarios": {
            post: {
                tags: ["Autenticação"],
                summary: "Cria uma conta nova (login automático — resposta já vem com token)",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["nome", "email", "senha"],
                                properties: {
                                    nome: { type: "string" },
                                    email: { type: "string" },
                                    senha: { type: "string", minLength: 8 },
                                },
                            },
                        },
                    },
                },
                responses: {
                    201: {
                        description: "Conta criada",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        token: { type: "string" },
                                        user: {
                                            type: "object",
                                            properties: {
                                                id: { type: "integer" },
                                                nome: { type: "string" },
                                                email: { type: "string" },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    400: { description: "Dados obrigatórios ausentes, senha curta ou e-mail já cadastrado", content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } } },
                    429: { $ref: "#/components/responses/MuitasRequisicoes" },
                },
            },
        },
        "/usuario/{id}": {
            get: {
                tags: ["Usuário"],
                summary: "Busca o perfil de um usuário (só o próprio dono)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                responses: {
                    200: { description: "Perfil do usuário (sem a senha)", content: { "application/json": { schema: { $ref: "#/components/schemas/Usuario" } } } },
                    401: { $ref: "#/components/responses/NaoAutorizado" },
                    403: { description: "Tentando acessar o perfil de outro usuário" },
                    404: { description: "Usuário não encontrado" },
                },
            },
            put: {
                tags: ["Usuário"],
                summary: "Atualiza dados do perfil (só o próprio dono)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    nome: { type: "string" },
                                    email: { type: "string" },
                                    avatar_url: { type: "string" },
                                    senha: { type: "string" },
                                    nota_enem: { type: "number", nullable: true, minimum: 0, maximum: 1000 },
                                    modalidades: { type: "array", items: { type: "string" } },
                                    configuracoes: {
                                        type: "object",
                                        description: "Campos parciais de app_configuracoes (tema, idioma, notif_*, efeitos_sonoros, animacoes)",
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: { description: "Perfil atualizado" },
                    400: { description: "Dado inválido (ex.: nota fora de 0-1000, modalidade desconhecida, tema inválido)" },
                    401: { $ref: "#/components/responses/NaoAutorizado" },
                    403: { description: "Tentando editar o perfil de outro usuário" },
                },
            },
            delete: {
                tags: ["Usuário"],
                summary: "Exclui a conta (só o próprio dono)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                responses: {
                    200: { description: "Conta excluída" },
                    401: { $ref: "#/components/responses/NaoAutorizado" },
                    403: { description: "Tentando excluir a conta de outro usuário" },
                    404: { description: "Usuário não encontrado" },
                },
            },
        },
        "/favoritos": {
            get: {
                tags: ["Favoritos"],
                summary: "Lista os cursos favoritados pelo usuário logado",
                security: [{ bearerAuth: [] }],
                responses: {
                    200: { description: "Lista de favoritos", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Favorito" } } } } },
                    401: { $ref: "#/components/responses/NaoAutorizado" },
                },
            },
            post: {
                tags: ["Favoritos"],
                summary: "Favorita um curso",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["codigo_curso", "sigla_universidade", "curso"],
                                properties: {
                                    codigo_curso: { type: "integer" },
                                    sigla_universidade: { type: "string" },
                                    curso: { type: "string" },
                                    nome_universidade: { type: "string" },
                                    uf_campus: { type: "string" },
                                    campus: { type: "string" },
                                    grau: { type: "string" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    201: { description: "Favorito criado", content: { "application/json": { schema: { $ref: "#/components/schemas/Favorito" } } } },
                    200: { description: "Já era favorito — devolve o registro existente" },
                    400: { description: "Campos obrigatórios ausentes" },
                    401: { $ref: "#/components/responses/NaoAutorizado" },
                },
            },
        },
        "/favoritos/{id}": {
            delete: {
                tags: ["Favoritos"],
                summary: "Remove um favorito (só o próprio dono)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                responses: {
                    200: { description: "Favorito removido" },
                    401: { $ref: "#/components/responses/NaoAutorizado" },
                    403: { description: "Favorito pertence a outro usuário" },
                    404: { description: "Favorito não encontrado" },
                },
            },
        },
        "/notificacoes": {
            get: {
                tags: ["Notificações"],
                summary: "Lista as últimas 30 notificações do usuário logado",
                security: [{ bearerAuth: [] }],
                responses: {
                    200: { description: "Lista de notificações", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Notificacao" } } } } },
                    401: { $ref: "#/components/responses/NaoAutorizado" },
                },
            },
        },
        "/notificacoes/lidas": {
            put: {
                tags: ["Notificações"],
                summary: "Marca todas as notificações do usuário como lidas",
                security: [{ bearerAuth: [] }],
                responses: {
                    200: { description: "Notificações marcadas como lidas" },
                    401: { $ref: "#/components/responses/NaoAutorizado" },
                },
            },
        },
        "/notificacoes/{id}/lida": {
            put: {
                tags: ["Notificações"],
                summary: "Marca uma notificação específica como lida (só o próprio dono)",
                security: [{ bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                responses: {
                    200: { description: "Notificação marcada como lida" },
                    401: { $ref: "#/components/responses/NaoAutorizado" },
                    403: { description: "Notificação pertence a outro usuário" },
                    404: { description: "Notificação não encontrada" },
                },
            },
        },
        "/admin/importacoes/analisar": {
            post: {
                tags: ["Admin"],
                summary: "Analisa uma planilha de notas de corte sem gravar nada (dry-run)",
                description:
                    "Faz o parsing e valida linha a linha (campos obrigatórios, UF válida, nota entre 0–1000, etc.). Não grava no banco — devolve um relatório pro admin revisar antes de confirmar.",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "multipart/form-data": {
                            schema: {
                                type: "object",
                                required: ["arquivo", "ano"],
                                properties: {
                                    arquivo: { type: "string", format: "binary", description: "Planilha .xlsx do SISU/INEP" },
                                    ano: { type: "integer", description: "Ano civil a gravar (independe do código EDICAO bruto da planilha)" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: "Relatório da análise",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        totalLinhas: { type: "integer" },
                                        totalValidas: { type: "integer" },
                                        totalComErro: { type: "integer" },
                                        erros: {
                                            type: "array",
                                            description: "Até 100 primeiras linhas com erro",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    linha: { type: "integer" },
                                                    erros: { type: "array", items: { type: "string" } },
                                                },
                                            },
                                        },
                                        anoJaTemDados: { type: "boolean" },
                                        totalLinhasExistentes: { type: "integer" },
                                    },
                                },
                            },
                        },
                    },
                    400: { description: "Arquivo/ano ausente ou planilha com estrutura inválida", content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } } },
                    401: { $ref: "#/components/responses/NaoAutorizado" },
                    403: { description: "Usuário autenticado não é admin" },
                    429: { $ref: "#/components/responses/MuitasRequisicoes" },
                },
            },
        },
        "/admin/importacoes/confirmar": {
            post: {
                tags: ["Admin"],
                summary: "Confirma a importação da planilha (grava no banco, dentro de uma transação)",
                description:
                    "Reprocessa o mesmo arquivo enviado em /analisar (nada fica guardado no servidor entre os dois passos) e grava as linhas válidas. Se já existir dado pro ano e `substituir` não for true, recusa com 409.",
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "multipart/form-data": {
                            schema: {
                                type: "object",
                                required: ["arquivo", "ano"],
                                properties: {
                                    arquivo: { type: "string", format: "binary" },
                                    ano: { type: "integer" },
                                    substituir: { type: "boolean", description: "Apaga os dados existentes do ano antes de inserir os novos" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: { description: "Importação concluída" },
                    400: { description: "Arquivo/ano ausente ou planilha com estrutura inválida", content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } } },
                    401: { $ref: "#/components/responses/NaoAutorizado" },
                    403: { description: "Usuário autenticado não é admin" },
                    409: { description: "Ano já tem dados e substituir não foi confirmado", content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } } },
                    429: { $ref: "#/components/responses/MuitasRequisicoes" },
                },
            },
        },
        "/admin/importacoes": {
            get: {
                tags: ["Admin"],
                summary: "Histórico das últimas 50 importações confirmadas",
                security: [{ bearerAuth: [] }],
                responses: {
                    200: { description: "Lista de importações" },
                    401: { $ref: "#/components/responses/NaoAutorizado" },
                    403: { description: "Usuário autenticado não é admin" },
                },
            },
        },
    },
};
