import { Router } from "express";
import multer from "multer";
import { NotasCorteController } from "./Controllers/NotaCorteController";
import { UsuarioController } from "./Controllers/UsuarioController";
import { AuthController } from "./Controllers/AuthController";
import { FavoritoController } from "./Controllers/FavoritoController";
import { NotificacaoController } from "./Controllers/NotificacaoController";
import { ImportacaoController } from "./Controllers/ImportacaoController";
import { authMiddleware } from "./middlewares/authMiddleware";
import { adminMiddleware } from "./middlewares/adminMiddleware";
import {
  limiterBusca, limiterLogin, limiterCadastro, limiterRecuperacaoSenha, limiterImportacao,
} from "./middlewares/rateLimit";

const usuarioController = new UsuarioController();
const controller = new NotasCorteController();
const favoritoController = new FavoritoController();
const notificacaoController = new NotificacaoController();
const authController = new AuthController();
const importacaoController = new ImportacaoController();
const routes = Router();

// Planilhas ficam só em memória (nunca tocam o disco) — processadas e
// descartadas dentro da própria requisição. Limite de 20MB cobre com folga
// as planilhas do SISU (na casa de poucos MB).
const uploadPlanilha = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// Rotas públicas (pesquisa de notas de corte é livre). Sem autenticação
// pra travar quem bate nelas, o rate limit por IP é a única barreira
// contra scraping/automação.
routes.get("/pesquisar", limiterBusca, new NotasCorteController().search);
routes.get("/sugestoes", limiterBusca, controller.suggestions);
routes.get("/stats", limiterBusca, (req, res) => new UsuarioController().getDashboardStats(req, res));
routes.get("/anos-disponiveis", limiterBusca, controller.anosDisponiveis);
routes.get("/estados-disponiveis", limiterBusca, controller.estadosDisponiveis);
routes.get("/municipios-disponiveis", limiterBusca, controller.municipiosDisponiveis);
routes.get("/instituicoes-disponiveis", limiterBusca, controller.instituicoesDisponiveis);
routes.get("/cursos-disponiveis", limiterBusca, controller.cursosDisponiveis);

// Autenticação — limites mais apertados: /login contra força bruta de
// senha, /usuarios contra criação automatizada de contas.
routes.post("/login", limiterLogin, authController.login);
routes.post("/login/google", limiterLogin, authController.loginGoogle);
routes.post("/usuarios", limiterCadastro, usuarioController.create);
routes.post("/recuperar-senha", limiterRecuperacaoSenha, authController.recuperarSenha);
routes.post("/redefinir-senha", limiterRecuperacaoSenha, authController.redefinirSenha);

// Rotas protegidas (exigem token válido e dono do recurso)
routes.get("/usuario/:id", authMiddleware, usuarioController.getProfile);
routes.put("/usuario/:id", authMiddleware, usuarioController.updateProfile);
routes.delete("/usuario/:id", authMiddleware, usuarioController.delete);

routes.get("/favoritos", authMiddleware, favoritoController.list);
routes.post("/favoritos", authMiddleware, favoritoController.create);
routes.delete("/favoritos/:id", authMiddleware, favoritoController.remove);

routes.get("/notificacoes", authMiddleware, notificacaoController.list);
routes.put("/notificacoes/lidas", authMiddleware, notificacaoController.markAllAsRead);
routes.put("/notificacoes/:id/lida", authMiddleware, notificacaoController.markAsRead);

// Área do admin — importação de planilhas de notas de corte.
routes.post(
  "/admin/importacoes/analisar",
  authMiddleware, adminMiddleware, limiterImportacao, uploadPlanilha.single("arquivo"),
  importacaoController.analisar
);
routes.post(
  "/admin/importacoes/confirmar",
  authMiddleware, adminMiddleware, limiterImportacao, uploadPlanilha.single("arquivo"),
  importacaoController.confirmar
);
routes.get("/admin/importacoes", authMiddleware, adminMiddleware, importacaoController.listarHistorico);

export default routes;
