import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import { AppDataSource } from "../database/datasource";
import { Usuario } from "../Entities/Usuario";
import { UsuarioConfig } from "../Entities/UsuarioConfig";
import { signToken } from "../utils/jwt";
import { CONFIG_PADRAO } from "./UsuarioController";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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

            if (!usuario.senha_hash) {
                return res.status(401).json({
                    error: "Essa conta foi criada com login do Google. Entre usando o botão \"Continuar com Google\"."
                });
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

    // Login/cadastro via Google: o front manda o "credential" (um JWT já
    // assinado pelo Google, obtido via Google Identity Services). A gente
    // só precisa validar a assinatura/audiência — nenhuma senha nem client
    // secret envolvidos nesse fluxo.
    async loginGoogle(req: Request, res: Response) {
        const { credential } = req.body;

        if (!credential) {
            return res.status(400).json({ error: "Token do Google não informado" });
        }
        if (!process.env.GOOGLE_CLIENT_ID) {
            console.error("GOOGLE_CLIENT_ID não configurado no .env");
            return res.status(500).json({ error: "Login com Google não está configurado no servidor" });
        }

        let payload;
        try {
            const ticket = await googleClient.verifyIdToken({
                idToken: credential,
                audience: process.env.GOOGLE_CLIENT_ID,
            });
            payload = ticket.getPayload();
        } catch (error) {
            return res.status(401).json({ error: "Token do Google inválido ou expirado" });
        }

        if (!payload?.email) {
            return res.status(401).json({ error: "Não foi possível obter o e-mail da conta Google" });
        }
        if (!payload.email_verified) {
            return res.status(401).json({ error: "O e-mail dessa conta Google não está verificado" });
        }

        const repo = AppDataSource.getRepository(Usuario);
        try {
            let usuario = await repo.findOneBy({ google_id: payload.sub });

            if (!usuario) {
                // Já existe conta com esse e-mail (criada por senha)? Linka o
                // Google a ela em vez de criar uma conta duplicada.
                usuario = await repo.findOneBy({ email: payload.email });
                if (usuario) {
                    usuario.google_id = payload.sub;
                    if (payload.picture && !usuario.avatar_url) usuario.avatar_url = payload.picture;
                    await repo.save(usuario);
                }
            }

            if (!usuario) {
                usuario = repo.create({
                    nome: payload.name || payload.email.split("@")[0] || payload.email,
                    email: payload.email,
                    avatar_url: payload.picture || "",
                    google_id: payload.sub,
                    senha_hash: null,
                });
                await repo.save(usuario);

                const configRepo = AppDataSource.getRepository(UsuarioConfig);
                await configRepo.save(configRepo.create({ usuario_id: usuario.id, ...CONFIG_PADRAO }));
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
            return res.status(500).json({ error: "Erro ao autenticar com Google" });
        }
    }
}
