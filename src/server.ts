import express from "express";
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { AppDataSource } from "./database/datasource";
import routes from "./routes";
import { agendarNotificacoes } from "./jobs/notificacoesJob";
import { limiterGlobal } from "./middlewares/rateLimit";
import { setupSwagger } from "./docs/swagger";

// Origens que podem chamar a API pelo navegador. Sem CORS_ORIGINS definido
// (ex.: alguém rodando local sem configurar), cai só no Vite local — nunca
// libera geral ("*"), pra não deixar qualquer site fazer requisições
// autenticadas contra a API em produção.
const corsOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173")
    .split(",")
    .map((origem) => origem.trim())
    .filter(Boolean);

AppDataSource.initialize().then(() => {
    const app = express();

    // Necessário pra req.ip (usado no rate limit) refletir o IP real do
    // cliente em vez do proxy/load balancer na frente do backend (Render
    // e afins sempre ficam atrás de um).
    app.set("trust proxy", 1);

    // Headers de segurança padrão (X-Content-Type-Options, X-Frame-Options,
    // etc.). crossOriginResourcePolicy desligado porque a API é consumida
    // por um front em outra origem — a política real de quem pode chamar
    // já é o CORS abaixo, não precisa duplicar aqui.
    app.use(helmet({ crossOriginResourcePolicy: false }));
    app.use(cors({ origin: corsOrigins }));
    app.use(compression());
    app.use(express.json());
    app.use(limiterGlobal);
    setupSwagger(app);
    app.use(routes);

    agendarNotificacoes();

    return app.listen(3333, () => console.log("Servidor rodando na porta 3333 e Banco Conectado!"));
}).catch(error => console.log("Erro ao conectar no banco:", error));