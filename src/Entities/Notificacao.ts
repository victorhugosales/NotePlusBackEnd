import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from "typeorm";

@Entity("app_notificacoes")
export class Notificacao {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  usuario_id!: number;

  @Column()
  tipo!: string; // 'curso_em_alta' | 'curso_similar_favorito'

  @Column()
  titulo!: string;

  @Column()
  mensagem!: string;

  @Column({ default: false })
  lida!: boolean;

  @CreateDateColumn()
  created_at!: Date;
}
