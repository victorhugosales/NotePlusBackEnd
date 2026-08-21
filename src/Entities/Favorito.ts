import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from "typeorm";

@Entity("app_favoritos")
export class Favorito {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  usuario_id!: number;

  @Column()
  codigo_curso!: number;

  @Column()
  sigla_universidade!: string;

  @Column()
  curso!: string;

  @Column({ nullable: true })
  nome_universidade?: string;

  @Column({ nullable: true })
  uf_campus?: string;

  @Column({ nullable: true })
  campus?: string;

  @Column({ nullable: true })
  grau?: string;

  @CreateDateColumn()
  created_at!: Date;
}
