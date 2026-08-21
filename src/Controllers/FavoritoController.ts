import { Response } from "express";
import { AppDataSource } from "../database/datasource";
import { Favorito } from "../Entities/Favorito";
import { AuthRequest } from "../middlewares/authMiddleware";

export class FavoritoController {
    async list(req: AuthRequest, res: Response) {
        const usuarioId = req.userId;
        if (!usuarioId) return res.status(401).json({ error: "Não autenticado" });

        const repo = AppDataSource.getRepository(Favorito);

        try {
            const favoritos = await repo.find({
                where: { usuario_id: usuarioId },
                order: { created_at: "DESC" },
            });
            return res.json(favoritos);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: "Erro ao buscar favoritos" });
        }
    }

    async create(req: AuthRequest, res: Response) {
        const usuarioId = req.userId;
        if (!usuarioId) return res.status(401).json({ error: "Não autenticado" });

        const { codigo_curso, sigla_universidade, curso, nome_universidade, uf_campus, campus, grau } = req.body;

        if (!codigo_curso || !sigla_universidade || !curso) {
            return res.status(400).json({ error: "codigo_curso, sigla_universidade e curso são obrigatórios" });
        }

        const repo = AppDataSource.getRepository(Favorito);

        try {
            const existente = await repo.findOneBy({
                usuario_id: usuarioId,
                codigo_curso: Number(codigo_curso),
                sigla_universidade: String(sigla_universidade),
            });
            if (existente) return res.status(200).json(existente);

            const favorito = repo.create({
                usuario_id: usuarioId,
                codigo_curso: Number(codigo_curso),
                sigla_universidade: String(sigla_universidade),
                curso,
                nome_universidade,
                uf_campus,
                campus,
                grau,
            });
            await repo.save(favorito);

            return res.status(201).json(favorito);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: "Erro ao favoritar curso" });
        }
    }

    async remove(req: AuthRequest, res: Response) {
        const usuarioId = req.userId;
        if (!usuarioId) return res.status(401).json({ error: "Não autenticado" });

        const { id } = req.params;
        const repo = AppDataSource.getRepository(Favorito);

        try {
            const favorito = await repo.findOneBy({ id: Number(id) });
            if (!favorito) return res.status(404).json({ error: "Favorito não encontrado" });
            if (favorito.usuario_id !== usuarioId) {
                return res.status(403).json({ error: "Você não tem permissão para remover este favorito" });
            }

            await repo.remove(favorito);
            return res.json({ message: "Favorito removido" });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: "Erro ao remover favorito" });
        }
    }
}
