import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
// Sessão sem "lembrar de mim": token de vida curta. O front guarda essa
// sessão em sessionStorage (some ao fechar o navegador), mas o token em si
// também expira rápido — assim ele não continua válido por 7 dias caso
// vaze ou seja copiado antes da aba fechar.
const JWT_EXPIRES_IN_SEM_LEMBRAR = process.env.JWT_EXPIRES_IN_SEM_LEMBRAR || "12h";

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET não definido nas variáveis de ambiente");
}

export interface TokenPayload {
  id: number;
  email: string;
}

export function signToken(payload: TokenPayload, lembrar: boolean = true): string {
  const expiresIn = lembrar ? JWT_EXPIRES_IN : JWT_EXPIRES_IN_SEM_LEMBRAR;
  const options = { expiresIn } as jwt.SignOptions;
  return jwt.sign(payload, JWT_SECRET, options);
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}
