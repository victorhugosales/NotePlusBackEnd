import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import { AppDataSource } from "../database/datasource";
import { Usuario } from "../Entities/Usuario";
import { UsuarioConfig } from "../Entities/UsuarioConfig";
import { signToken } from "../utils/jwt";
import { enviarEmailRedefinicaoSenha } from "../utils/email";
import { CONFIG_PADRAO } from "./UsuarioController";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const RESET_TOKEN_VALIDADE_MS = 60 * 60 * 1000; // 1 hora

function hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
}

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
                    email: usuario.email,
                    is_admin: usuario.is_admin
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
                    email: usuario.email,
                    is_admin: usuario.is_admin
                }
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: "Erro ao autenticar com Google" });
        }
    }

    // Passo 1 da recuperação de senha: gera um token, guarda só o hash dele
    // (com validade de 1h) e manda o link por e-mail via Resend.
    //
    // Sempre responde com a mesma mensagem de sucesso, exista ou não conta
    // com esse e-mail — senão a rota vira um jeito de descobrir quais
    // e-mails estão cadastrados (enumeração de contas).
    async recuperarSenha(req: Request, res: Response) {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: "Informe o e-mail" });

        const mensagemGenerica = {
            message: "Se existir uma conta com esse e-mail, enviamos um link de redefinição de senha."
        };

        const repo = AppDataSource.getRepository(Usuario);
        try {
            const usuario = await repo.findOne({ where: { email } });

            // Sem conta, ou conta só de login social (sem senha nossa pra
            // redefinir): não faz nada, mas responde igual à mensagem de
            // sucesso — não revela qual é o caso pro cliente.
            if (usuario && usuario.senha_hash) {
                const token = crypto.randomBytes(32).toString("hex");
                usuario.reset_token_hash = hashToken(token);
                usuario.reset_token_expira_em = new Date(Date.now() + RESET_TOKEN_VALIDADE_MS);
                await repo.save(usuario);

                const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
                const link = `${frontendUrl}/redefinir-senha?token=${token}`;
                await enviarEmailRedefinicaoSenha(usuario.email, link);
            }

            return res.json(mensagemGenerica);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: "Erro ao solicitar redefinição de senha" });
        }
    }

    // Passo 2: valida o token (comparando o hash) e a expiração, troca a
    // senha e invalida o token (não dá pra reusar o mesmo link duas vezes).
    async redefinirSenha(req: Request, res: Response) {
        const { token, novaSenha } = req.body;
        if (!token || !novaSenha) {
            return res.status(400).json({ error: "Informe o token e a nova senha" });
        }

        const senhaValida = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(novaSenha);
        if (!senhaValida) {
            return res.status(400).json({ error: "A senha deve ter no mínimo 8 caracteres, com letras e números" });
        }

        const repo = AppDataSource.getRepository(Usuario);
        try {
            const usuario = await repo.findOne({ where: { reset_token_hash: hashToken(token) } });

            if (!usuario || !usuario.reset_token_expira_em || usuario.reset_token_expira_em < new Date()) {
                return res.status(400).json({ error: "Link de redefinição inválido ou expirado" });
            }

            usuario.senha_hash = await bcrypt.hash(novaSenha, 10);
            usuario.reset_token_hash = null;
            usuario.reset_token_expira_em = null;
            await repo.save(usuario);

            return res.json({ message: "Senha redefinida com sucesso" });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: "Erro ao redefinir senha" });
        }
    }
}
