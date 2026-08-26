import { Entity, Column, PrimaryGeneratedColumn } from "typeorm";

@Entity("NotasDeCortes")
export class NotasCorte {
  @PrimaryGeneratedColumn({ name: 'id_projeto' })
  id_projeto!: number; // Se não tiver ID, use uma composta ou crie um serial no banco

  @Column({ name: 'CO_IES' })
  codigo_instituicao!: number

  @Column({ name: 'EDICAO' })
  ano!: number;

  @Column({ name: 'NO_IES' })
  nome_universidade!: string;

  @Column({ name: 'SG_IES' })
  sigla_universidade!: string;

  @Column ({name: 'SG_UF_CAMPUS'})
  uf_campus!: string

  @Column({ name: 'NO_CAMPUS' })
  campus!: string;

  @Column({ name: 'NO_MUNICIPIO_CAMPUS' })
  cidade!: string;

  @Column({ name: 'CO_IES_CURSO' })
  codigo_curso!: number;

  @Column({ name: 'NO_CURSO' })
  curso!: string;

  @Column({ name: 'TIPO_CONCORRENCIA' })
  modalidade!: string; // Ex: "LB_PPI", "AC"

  @Column({ name: 'DS_MOD_CONCORRENCIA' })
  descricao_cota!: string;

  // Matutino/Vespertino/Noturno/EAD etc. Duas linhas com a mesma
  // modalidade só são "o mesmo curso" se também tiverem o mesmo turno —
  // senão são ofertas distintas com vagas e notas de corte próprias.
  @Column({ name: 'DS_TURNO', nullable: true })
  turno?: string;

  @Column({ name: 'QT_VAGAS_OFERTADAS' })
  vagas!: number;

  @Column({ name: 'QT_INSCRICAO' })
  inscritos!: number;

  @Column ({name: 'DS_GRAU'})
  grau!: string;

  // Federal/Estadual/Municipal — filtro "Categoria" da página de Faculdades.
  @Column({ name: 'DS_CATEGORIA_ADM', nullable: true })
  categoria_administrativa?: string;

  @Column({
    type: "decimal",
    name: 'NU_NOTACORTE',
    transformer: {
      from: (value: string) => value ? parseFloat(value.replace(',', '.')) : 0,
      to: (value: number) => value
    }
  })
  nota_corte!: number;
}