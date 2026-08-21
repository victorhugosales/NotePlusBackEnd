import { Response } from "express";
import bcrypt from "bcryptjs";
import { AppDataSource } from "../database/datasource";
import { Usuario } from "../Entities/Usuario";
import { UsuarioConfig } from "../Entities/UsuarioConfig";
import { NotasCorte } from "../Entities/NotasCorte";
import { AuthRequest } from "../middlewares/authMiddleware";
import { signToken } from "../utils/jwt";
import { statsCache, STATS_CACHE_KEY } from "../cache/searchCache";

const SALT_ROUNDS = 10;

// Modalidades de concorrência reconhecidas (Lei de Cotas, 12.711/2012).
// Mesma lista usada no front pra montar os checkboxes — validamos aqui de
// novo pra não deixar o banco receber valor arbitrário vindo da API.
export const MODALIDADES_VALIDAS = [
    "AC", "LB_PPI", "LI_PPI", "LB_Q", "LI_Q", "LB_PCD", "LI_PCD", "LB_EP", "LI_EP"
];

// Configuração padrão criada pra todo usuário novo, e usada como base ao
// editar as configurações de alguém que ainda não tinha uma linha em
// app_configuracoes (contas criadas antes desse recurso existir).
const CONFIG_PADRAO = {
    notif_cursos: false,
    notif_atualizacoes: false,
    notif_mensagens: false,
    efeitos_sonoros: true,
    animacoes: true,
    tema: "light",
    idioma: "pt",
};

const CAMPOS_CONFIG_PERMITIDOS = [
    "notif_cursos", "notif_atualizacoes", "notif_mensagens",
    "efeitos_sonoros", "animacoes", "tema", "idioma",
] as const;
const TEMAS_VALIDOS = ["light", "dark"];

export class UsuarioController {
    async getProfile(req: AuthRequest, res: Response) {
        const { id } = req.params;

        if (req.userId !== Number(id)) {
            return res.status(403).json({ error: "Você não tem permissão para acessar este perfil" });
        }

        const repo = AppDataSource.getRepository(Usuario);

        try {
            const usuario = await repo.findOne({
                where: { id: Number(id) },
                relations: ["configuracoes"]
            });
            if (!usuario) return res.status(404).json({ error: "Usuário não encontrado" });

            const { senha_hash, ...usuarioSemSenha } = usuario;
            return res.json(usuarioSemSenha);
        } catch (error) {
            return res.status(500).json({ error: "Erro ao buscar perfil" });
        }
    }

    async updateProfile(req: AuthRequest, res: Response) {
        const { id } = req.params;
        const { nome, email, avatar_url, senha, nota_enem, modalidades, configuracoes } = req.body;

        if (req.userId !== Number(id)) {
            return res.status(403).json({ error: "Você não tem permissão para editar este perfil" });
        }

        if (nota_enem !== undefined && nota_enem !== null) {
            const nota = Number(nota_enem);
            if (!Number.isFinite(nota) || nota < 0 || nota > 1000) {
                return res.status(400).json({ error: "Nota do ENEM deve ser um número entre 0 e 1000" });
            }
        }

        if (modalidades !== undefined) {
            const invalida = !Array.isArray(modalidades) ||
                modalidades.some((m: unknown) => typeof m !== "string" || !MODALIDADES_VALIDAS.includes(m));
            if (invalida) {
                return res.status(400).json({ error: "Modalidade de concorrência inválida" });
            }
        }

        if (configuracoes !== undefined) {
            if (typeof configuracoes !== "object" || configuracoes === null || Array.isArray(configuracoes)) {
                return res.status(400).json({ error: "Configurações inválidas" });
            }
            if (configuracoes.tema !== undefined && !TEMAS_VALIDOS.includes(configuracoes.tema)) {
                return res.status(400).json({ error: "Tema inválido" });
            }
        }

        const repo = AppDataSource.getRepository(Usuario);

        try {
            const updateData: Partial<Usuario> = {};
            if (nome) updateData.nome = nome;
            if (email) updateData.email = email;
            if (avatar_url) updateData.avatar_url = avatar_url;
            if (senha) updateData.senha_hash = await bcrypt.hash(senha, SALT_ROUNDS);
            if (nota_enem !== undefined) updateData.nota_enem = nota_enem === null ? null : Number(nota_enem);
            if (modalidades !== undefined) updateData.modalidades = modalidades;

            if (Object.keys(updateData).length > 0) {
                await repo.update(Number(id), updateData);
            }

            if (configuracoes !== undefined) {
                const configRepo = AppDataSource.getRepository(UsuarioConfig);
                const configData: Record<string, unknown> = {};
                for (const campo of CAMPOS_CONFIG_PERMITIDOS) {
                    if (configuracoes[campo] !== undefined) configData[campo] = configuracoes[campo];
                }

                const existente = await configRepo.findOneBy({ usuario_id: Number(id) });
                if (existente) {
                    await configRepo.update({ usuario_id: Number(id) }, configData);
                } else {
                    await configRepo.save(configRepo.create({
                        usuario_id: Number(id),
                        ...CONFIG_PADRAO,
                        ...configData,
                    }));
                }
            }

            return res.json({ message: "Perfil atualizado com sucesso!" });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: "Erro ao atualizar" });
        }
    }

    async create(req: AuthRequest, res: Response) {
        const { nome, email, senha } = req.body;

        if (!nome || !email || !senha) {
            return res.status(400).json({ error: "Nome, e-mail e senha são obrigatórios" });
        }

        if (senha.length < 8) {
            return res.status(400).json({ error: "A senha deve ter no mínimo 8 caracteres" });
        }

        const repo = AppDataSource.getRepository(Usuario);

        try {
            const userExists = await repo.findOneBy({ email });
            if (userExists) return res.status(400).json({ error: "Email já cadastrado" });

            const senha_hash = await bcrypt.hash(senha, SALT_ROUNDS);

            const novoUsuario = repo.create({
                nome,
                email,
                senha_hash
            });

            await repo.save(novoUsuario);

            const configRepo = AppDataSource.getRepository(UsuarioConfig);
            await configRepo.save(configRepo.create({ usuario_id: novoUsuario.id, ...CONFIG_PADRAO }));

            const token = signToken({ id: novoUsuario.id, email: novoUsuario.email });

            return res.status(201).json({
                token,
                user: {
                    id: novoUsuario.id,
                    nome: novoUsuario.nome,
                    email: novoUsuario.email
                }
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: "Erro ao criar conta" });
        }
    }

    async delete(req: AuthRequest, res: Response) {
        const { id } = req.params;

        if (req.userId !== Number(id)) {
            return res.status(403).json({ error: "Você não tem permissão para excluir este perfil" });
        }

        const repo = AppDataSource.getRepository(Usuario);

        try {
            const usuario = await repo.findOneBy({ id: Number(id) });

            if (!usuario) {
                return res.status(404).json({ error: "Usuário não encontrado para exclusão." });
            }

            await repo.remove(usuario);

            return res.json({ message: "Conta deletada com sucesso. Sentiremos sua falta!" });

        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: "Erro interno ao deletar a conta." });
        }
    }

    async getDashboardStats(req: AuthRequest, res: Response) {
        const cached = statsCache.get(STATS_CACHE_KEY);
        if (cached) {
            res.setHeader("X-Cache", "HIT");
            return res.json(cached);
        }

        const repo = AppDataSource.getRepository(NotasCorte);

        try {
            const stats = await repo
                .createQueryBuilder("nota")
                .select("COUNT(DISTINCT nota.curso)", "totalCursos")
                .addSelect("COUNT(DISTINCT nota.codigo_instituicao)", "totalFaculdades")
                .addSelect("COUNT(DISTINCT nota.uf_campus)", "totalEstados")
                .getRawOne();

            const totalCursos = parseInt(stats.totalCursos);
            const totalFaculdades = parseInt(stats.totalFaculdades);
            const totalEstados = parseInt(stats.totalEstados) || 0;

            const mediaCursos = totalFaculdades > 0
                ? (totalCursos / totalFaculdades).toFixed(1)
                : 0;
            const resultado = {
                totalCursos,
                totalFaculdades,
                totalEstados,
                mediaCursos
            };
            statsCache.set(STATS_CACHE_KEY, resultado);
            res.setHeader("X-Cache", "MISS");
            return res.json(resultado);
        } catch (error) {
            console.error("Erro no Dashboard:", error);
            return res.status(500).json({ error: "Erro ao buscar estatísticas" });
        }
    }
}