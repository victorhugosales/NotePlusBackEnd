import rateLimit from "express-rate-limit";

// express-rate-limit identifica quem está fazendo a requisição pelo IP
// (req.ip) por padrão — cada IP tem seu próprio contador de requisições
// dentro da janela de tempo (windowMs). Passado o limite, a rota responde
// 429 automaticamente até a janela reiniciar.
//
// req.ip só reflete o IP real do cliente (em vez do IP do proxy/load
// balancer na frente do backend) porque `app.set("trust proxy", ...)` está
// habilitado em server.ts — sem isso, todo mundo atrás do mesmo proxy
// cairia no mesmo contador.

// Rotas de busca pública (/pesquisar, /sugestoes, /stats): sem login,
// batidas a cada tecla digitada no autocomplete. Limite generoso, só pra
// barrar scraping/automação, não o uso normal.
export const limiterBusca = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas requisições. Aguarde um instante e tente de novo." },
});

// /login: alvo clássico de força bruta de senha. Limite baixo por IP.
export const limiterLogin = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas de login. Aguarde alguns minutos e tente de novo." },
});

// /recuperar-senha e /redefinir-senha: cada solicitação dispara um e-mail
// (custo real no provedor) e cada tentativa de redefinir é uma tentativa de
// adivinhar/força-bruta o token. Limite baixo por IP em ambas.
export const limiterRecuperacaoSenha = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas solicitações de redefinição de senha. Aguarde um pouco e tente de novo." },
});

// /usuarios (cadastro): evita criação automatizada de contas em massa.
export const limiterCadastro = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas contas criadas a partir deste IP. Tente novamente mais tarde." },
});

// Camada de segurança geral, aplicada em toda a API (inclusive rotas
// autenticadas) — não substitui os limites específicos acima, só evita que
// qualquer rota fique completamente sem teto.
export const limiterGlobal = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas requisições vindas deste endereço. Aguarde um instante." },
});
