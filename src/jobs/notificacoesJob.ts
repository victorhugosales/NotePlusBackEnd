import cron from "node-cron";
import { AppDataSource } from "../database/datasource";
import { UsuarioConfig } from "../Entities/UsuarioConfig";
import { Favorito } from "../Entities/Favorito";
import { Notificacao } from "../Entities/Notificacao";
import { NotasCorte } from "../Entities/NotasCorte";

// Edição usada pra gerar as notificações. Mesma lógica de outras telas: sem
// isso, com 2025 e 2026 convivendo na tabela, poderíamos sugerir cursos de
// uma edição já encerrada.
const ANO_REFERENCIA = "2026";

// Quantos cursos mais concorridos entram no "sorteio" de curso em alta.
const TOP_CURSOS_EM_ALTA = 50;

function sorteiaUm<T>(lista: T[]): T | undefined {
    if (lista.length === 0) return undefined;
    return lista[Math.floor(Math.random() * lista.length)];
}

// Pra cada usuário com notificações habilitadas, gera 1 notificação: às
// vezes um curso parecido com um dos favoritos (mesmo curso, outra
// universidade), às vezes um curso em alta (muitos inscritos). Sempre com
// uma escolha aleatória entre os candidatos, não sempre o mesmo resultado.
export async function gerarNotificacoesParaTodos() {
    const configRepo = AppDataSource.getRepository(UsuarioConfig);
    const favoritoRepo = AppDataSource.getRepository(Favorito);
    const notificacaoRepo = AppDataSource.getRepository(Notificacao);
    const notaRepo = AppDataSource.getRepository(NotasCorte);

    const usuariosComNotifAtiva = await configRepo
        .createQueryBuilder("config")
        .where("config.notif_cursos = true")
        .orWhere("config.notif_atualizacoes = true")
        .getMany();

    for (const config of usuariosComNotifAtiva) {
        try {
            const favoritos = await favoritoRepo.find({ where: { usuario_id: config.usuario_id } });
            const tentarSimilar = favoritos.length > 0 && Math.random() < 0.5;

            if (tentarSimilar) {
                const favoritoEscolhido = sorteiaUm(favoritos)!;
                const similares = await notaRepo
                    .createQueryBuilder("nota")
                    .select("DISTINCT nota.sigla_universidade", "sigla_universidade")
                    .addSelect("nota.nome_universidade", "nome_universidade")
                    .addSelect("nota.codigo_curso", "codigo_curso")
                    .addSelect("nota.curso", "curso")
                    .where("nota.curso = :curso", { curso: favoritoEscolhido.curso })
                    .andWhere("nota.sigla_universidade != :sigla", { sigla: favoritoEscolhido.sigla_universidade })
                    .andWhere("nota.ano = :ano", { ano: ANO_REFERENCIA })
                    .limit(20)
                    .getRawMany();

                const escolhido = sorteiaUm(similares);
                if (escolhido) {
                    await notificacaoRepo.save(notificacaoRepo.create({
                        usuario_id: config.usuario_id,
                        tipo: "curso_similar_favorito",
                        titulo: "Curso parecido com um dos seus favoritos",
                        mensagem: `${escolhido.curso} também é oferecido em ${escolhido.nome_universidade} (${escolhido.sigla_universidade}). Vale a pena conferir a nota de corte!`,
                    }));
                    continue;
                }
            }

            const candidatosEmAlta = await notaRepo
                .createQueryBuilder("nota")
                .select("nota.curso", "curso")
                .addSelect("nota.sigla_universidade", "sigla_universidade")
                .addSelect("nota.nome_universidade", "nome_universidade")
                .addSelect("nota.codigo_curso", "codigo_curso")
                .addSelect("nota.inscritos", "inscritos")
                .addSelect("nota.vagas", "vagas")
                .where("nota.ano = :ano", { ano: ANO_REFERENCIA })
                .orderBy("nota.inscritos", "DESC")
                .limit(TOP_CURSOS_EM_ALTA)
                .getRawMany();

            const escolhido = sorteiaUm(candidatosEmAlta);
            if (escolhido) {
                await notificacaoRepo.save(notificacaoRepo.create({
                    usuario_id: config.usuario_id,
                    tipo: "curso_em_alta",
                    titulo: "Curso em alta no SISU",
                    mensagem: `${escolhido.curso} em ${escolhido.nome_universidade} (${escolhido.sigla_universidade}) está com ${escolhido.inscritos} inscritos disputando ${escolhido.vagas} vagas.`,
                }));
            }
        } catch (error) {
            console.error(`Erro ao gerar notificação para usuário ${config.usuario_id}:`, error);
        }
    }
}

// Roda a cada 12h (00:00 e 12:00). Chamado uma vez a partir do server.ts.
export function agendarNotificacoes() {
    cron.schedule("0 */12 * * *", () => {
        gerarNotificacoesParaTodos().catch((error) =>
            console.error("Erro ao gerar notificações agendadas:", error)
        );
    });
}
