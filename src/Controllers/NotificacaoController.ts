import { Response } from "express";
import { AppDataSource } from "../database/datasource";
import { Notificacao } from "../Entities/Notificacao";
import { AuthRequest } from "../middlewares/authMiddleware";

export class NotificacaoController {
    async list(req: AuthRequest, res: Response) {
        const usuarioId = req.userId;
        if (!usuarioId) return res.status(401).json({ error: "Não autenticado" });

        const repo = AppDataSource.getRepository(Notificacao);

        try {
            const notificacoes = await repo.find({
                where: { usuario_id: usuarioId },
                order: { created_at: "DESC" },
                take: 30,
            });
            return res.json(notificacoes);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: "Erro ao buscar notificações" });
        }
    }

    async markAsRead(req: AuthRequest, res: Response) {
        const usuarioId = req.userId;
        if (!usuarioId) return res.status(401).json({ error: "Não autenticado" });

        const { id } = req.params;
        const repo = AppDataSource.getRepository(Notificacao);

        try {
            const notificacao = await repo.findOneBy({ id: Number(id) });
            if (!notificacao) return res.status(404).json({ error: "Notificação não encontrada" });
            if (notificacao.usuario_id !== usuarioId) {
                return res.status(403).json({ error: "Você não tem permissão para editar esta notificação" });
            }

            await repo.update(Number(id), { lida: true });
            return res.json({ message: "Notificação marcada como lida" });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: "Erro ao atualizar notificação" });
        }
    }

    async markAllAsRead(req: AuthRequest, res: Response) {
        const usuarioId = req.userId;
        if (!usuarioId) return res.status(401).json({ error: "Não autenticado" });

        const repo = AppDataSource.getRepository(Notificacao);

        try {
            await repo.update({ usuario_id: usuarioId, lida: false }, { lida: true });
            return res.json({ message: "Notificações marcadas como lidas" });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: "Erro ao atualizar notificações" });
        }
    }
}
