import { Router } from "express";
import { NotasCorteController } from "./Controllers/NotaCorteController";
import { UsuarioController } from "./Controllers/UsuarioController";
import { AuthController } from "./Controllers/AuthController";
import { authMiddleware } from "./middlewares/authMiddleware";

const usuarioController = new UsuarioController();
const controller = new NotasCorteController();
const routes = Router();

// Rotas públicas (pesquisa de notas de corte é livre)
routes.get("/pesquisar", new NotasCorteController().search);
routes.get("/sugestoes", controller.suggestions);
routes.get("/stats", (req, res) => new UsuarioController().getDashboardStats(req, res));

// Autenticação
routes.post("/login", new AuthController().login);
routes.post("/usuarios", usuarioController.create);

// Rotas protegidas (exigem token válido e dono do recurso)
routes.get("/usuario/:id", authMiddleware, usuarioController.getProfile);
routes.put("/usuario/:id", authMiddleware, usuarioController.updateProfile);
routes.delete("/usuario/:id", authMiddleware, usuarioController.delete);

export default routes;
