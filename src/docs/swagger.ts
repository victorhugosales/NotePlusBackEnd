import { Express } from "express";
import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "./openapi";

// Documentação interativa da API em /docs (Swagger UI) e o JSON puro em
// /docs.json (útil pra importar no Postman/Insomnia).
export function setupSwagger(app: Express) {
    app.get("/docs.json", (req, res) => res.json(openApiSpec));
    app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec, {
        customSiteTitle: "NotePlus+ API — Documentação",
    }));
}
