import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from "typeorm";

// Auditoria de cada importação de planilha de notas de corte feita por um
// admin — quem importou, qual ano, quantas linhas entraram/falharam.
@Entity("app_importacoes")
export class ImportacaoNotas {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  usuario_id!: number;

  @Column()
  ano!: number;

  @Column()
  nome_arquivo!: string;

  @Column()
  total_linhas!: number;

  @Column()
  linhas_importadas!: number;

  @Column()
  linhas_com_erro!: number;

  // 'substituiu' quando havia dados anteriores pro ano e foram apagados
  // antes de inserir os novos; 'adicionou' quando o ano estava vazio.
  @Column()
  modo!: string;

  @CreateDateColumn()
  created_at!: Date;
}
