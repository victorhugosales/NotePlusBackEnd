import { Entity, Column, PrimaryGeneratedColumn, OneToOne, JoinColumn } from "typeorm";
import { UsuarioConfig } from "./UsuarioConfig";

@Entity("app_usuarios")
export class Usuario {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  nome!: string;

  @Column()
  email!: string;

  @Column()
  senha_hash!: string;

  @Column()
  avatar_url!: string;

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

  @OneToOne(() => UsuarioConfig, (config) => config.usuario)
  configuracoes!: UsuarioConfig;
}