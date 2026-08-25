import { Entity, Column, PrimaryGeneratedColumn, OneToOne, JoinColumn } from "typeorm";
import { UsuarioConfig } from "./UsuarioConfig";

@Entity("app_usuarios")
export class Usuario {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  nome!: string;

  @Column({ unique: true })
  email!: string;

  // Nula para contas criadas via login social (Google) — não têm senha
  // nossa, só o link com a conta Google.
  //
  // "type" precisa ser explícito aqui: com o tipo TS em união com null
  // (string | null), o reflect-metadata não consegue inferir um tipo único
  // pro TypeORM, e ele tenta mapear a coluna como "Object" — que o driver
  // do Postgres não reconhece (DataTypeNotSupportedError). Colunas opcionais
  // sem "| null" (só "?") não têm esse problema, só as que aceitam null.
  @Column({ type: "varchar", nullable: true })
  senha_hash?: string | null;

  @Column()
  avatar_url!: string;

  // Identificador da conta Google vinculada (claim "sub" do token),
  // null para contas criadas com e-mail/senha que nunca linkaram o Google.
  @Column({ type: "varchar", nullable: true, unique: true })
  google_id?: string | null;

  @Column()
  buscas_realizadas!: number;

  @Column()
  limite_buscas!: number;

  // Nota do ENEM do usuário (0 a 1000). NUMERIC volta do Postgres como
  // string (evita perda de precisão); o transformer converte pra number.
  @Column({
    type: "numeric",
    nullable: true,
    transformer: {
      to: (value?: number | null) => value,
      from: (value: string | null) => (value !== null ? parseFloat(value) : null),
    },
  })
  nota_enem?: number | null;

  // Modalidades de concorrência que o usuário participa (AC, LB_EP, etc.).
  // simple-array guarda como texto separado por vírgula numa coluna text.
  @Column({ type: "simple-array", nullable: true })
  modalidades?: string[];

  // Recuperação de senha: guardamos o hash SHA-256 do token (não o token em
  // si) — assim, mesmo um vazamento do banco não permite gerar o link de
  // redefinição de ninguém. Token expira em 1h (reset_token_expira_em).
  @Column({ type: "varchar", nullable: true })
  reset_token_hash?: string | null;

  @Column({ type: "timestamp", nullable: true })
  reset_token_expira_em?: Date | null;

  // Acesso à área administrativa (ex.: importação de planilhas de notas de
  // corte). Promovido direto no banco — não existe fluxo de auto-promoção.
  @Column({ default: false })
  is_admin!: boolean;

  @OneToOne(() => UsuarioConfig, (config) => config.usuario)
  configuracoes!: UsuarioConfig;
}