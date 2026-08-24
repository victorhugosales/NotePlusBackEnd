import { Response, NextFunction } from "express";
import { AppDataSource } from "../database/datasource";
import { Usuario } from "../Entities/Usuario";
import { AuthRequest } from "./authMiddleware";

// Roda depois do authMiddleware (precisa de req.userId já definido).
// is_admin não vai no JWT — é conferido no banco a cada request, pra uma
// revogação de acesso valer imediatamente, sem esperar o token expirar.
export async function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.userId) {
    return res.status(401).json({ error: "Não autenticado" });
  }

  try {
    const repo = AppDataSource.getRepository(Usuario);
    const usuario = await repo.findOneBy({ id: req.userId });

    if (!usuario?.is_admin) {
      return res.status(403).json({ error: "Acesso restrito a administradores" });
    }

    return next();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erro no servidor" });
  }
}
