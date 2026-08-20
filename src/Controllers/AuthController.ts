import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { AppDataSource } from "../database/datasource";
import { Usuario } from "../Entities/Usuario";
import { signToken } from "../utils/jwt";

export class AuthController {
    async login(req: Request, res: Response) {
        const { email, senha } = req.body;

        if (!email || !senha) {
            return res.status(400).json({ error: "Informe e-mail e senha" });
        }

        const repo = AppDataSource.getRepository(Usuario);
        try {
            const usuario = await repo.findOne({ where: { email } });

            if (!usuario) {
                return res.status(401).json({ error: "Não encontramos uma conta com esse e-mail" });
            }

            const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
            if (!senhaValida) {
                return res.status(401).json({ error: "Senha incorreta" });
            }

            const token = signToken({ id: usuario.id, email: usuario.email });

            return res.json({
                token,
                user: {
                    id: usuario.id,
                    nome: usuario.nome,
                    email: usuario.email
                }
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: "Erro no servidor" });
        }
    }
}
