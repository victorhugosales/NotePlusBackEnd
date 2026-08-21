import express from "express";
import cors from 'cors';
import compression from 'compression';
import { AppDataSource } from "./database/datasource";
import routes from "./routes";

AppDataSource.initialize().then(() => {
    const app = express();

    app.use(cors());
    app.use(compression());
    app.use(express.json());
    app.use(routes);

    return app.listen(3333, () => console.log("Servidor rodando na porta 3333 e Banco Conectado!"));
}).catch(error => console.log("Erro ao conectar no banco:", error));