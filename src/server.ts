import express from "express";
import cors from 'cors';
import compression from 'compression';
import { AppDataSource } from "./database/datasource";
import routes from "./routes";
import { agendarNotificacoes } from "./jobs/notificacoesJob";
import { limiterGlobal } from "./middlewares/rateLimit";
import { setupSwagger } from "./docs/swagger";

AppDataSource.initialize().then(() => {
    const app = express();

    // Necessário pra req.ip (usado no rate limit) refletir o IP real do
    // cliente em vez do proxy/load balancer na frente do backend (Render
    // e afins sempre ficam atrás de um).
    app.set("trust proxy", 1);

    app.use(cors());
    app.use(compression());
    app.use(express.json());
    app.use(limiterGlobal);
    setupSwagger(app);
    app.use(routes);

    agendarNotificacoes();

    return app.listen(3333, () => console.log("Servidor rodando na porta 3333 e Banco Conectado!"));
}).catch(error => console.log("Erro ao conectar no banco:", error));