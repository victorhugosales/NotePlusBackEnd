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
    logging: true,
    entities: [NotasCorte, Usuario, UsuarioConfig, Favorito, Notificacao, ImportacaoNotas],
    migrations: [],
    subscribers: [],
    extra: {
        ssl: false
    }
})
