import "reflect-metadata";
import { DataSource } from "typeorm";
import { NotasCorte } from "../Entities/NotasCorte";
import { Usuario } from "../Entities/Usuario";
import { UsuarioConfig } from "../Entities/UsuarioConfig";
import { Favorito } from "../Entities/Favorito";
import { Notificacao } from "../Entities/Notificacao";
import { ImportacaoNotas } from "../Entities/ImportacaoNotas";
import "dotenv/config";

// APP_ENV escolhe qual bloco de credenciais do .env usar, sem precisar de
// múltiplos arquivos .env: "prod" -> produção, "dev" -> homologação,
// "local" -> Postgres local (ex.: dump restaurado na sua máquina).
const VALID_ENVS = ["prod", "dev", "local"] as const;
type AppEnv = (typeof VALID_ENVS)[number];

const rawEnv = process.env.APP_ENV || "local";

if (!VALID_ENVS.includes(rawEnv as AppEnv)) {
  throw new Error(
    `APP_ENV inválido: "${rawEnv}". Use um destes valores no seu .env: ${VALID_ENVS.join(", ")}.`
  );
}

const APP_ENV = rawEnv as AppEnv;

const PREFIX: Record<AppEnv, string> = {
  prod: "PROD",
  dev: "DEV",
  local: "LOCAL",
};

const prefix = PREFIX[APP_ENV];

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variável "${name}" não definida no .env (necessária para APP_ENV="${APP_ENV}").`
    );
  }
  return value;
}

console.log(`[datasource] APP_ENV="${APP_ENV}" — usando credenciais ${prefix}_TYPEORM_*`);

export const AppDataSource = new DataSource({
    type: "postgres",
    host: requiredEnv(`${prefix}_TYPEORM_HOST`),
    port: Number(process.env[`${prefix}_TYPEORM_PORT`]) || 5432,
    username: requiredEnv(`${prefix}_TYPEORM_USERNAME`),
    password: requiredEnv(`${prefix}_TYPEORM_PASSWORD`),
    database: requiredEnv(`${prefix}_TYPEORM_DATABASE`),
    synchronize: false,
    // Logging de query só faz sentido enquanto se debuga localmente — em
    // prod/homologação só polui os logs (e pode vazar dados de query).
    logging: APP_ENV === "local",
    entities: [NotasCorte, Usuario, UsuarioConfig, Favorito, Notificacao, ImportacaoNotas],
    migrations: [],
    subscribers: [],
    extra: {
        // Bancos gerenciados (prod e dev) exigem SSL; só o Postgres local
        // não usa. rejectUnauthorized: false porque o certificado do
        // provedor fica atrás de um pooler autoassinado.
        ssl: APP_ENV === "local" ? false : { rejectUnauthorized: false }
    }
})
