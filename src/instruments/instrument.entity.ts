import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Maps the provided `instruments` table; every column is nullable there. */
@Entity({ name: 'instruments' })
export class Instrument {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'ticker', type: 'varchar', length: 10, nullable: true })
  ticker!: string | null;

  @Column({ name: 'name', type: 'varchar', length: 255, nullable: true })
  name!: string | null;

  @Column({ name: 'type', type: 'varchar', length: 10, nullable: true })
  type!: string | null;
}
