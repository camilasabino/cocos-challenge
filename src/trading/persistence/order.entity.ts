import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'orders' })
export class Order {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'instrumentid', type: 'int', nullable: true })
  instrumentId!: number | null;

  @Column({ name: 'userid', type: 'int', nullable: true })
  userId!: number | null;

  @Column({ name: 'size', type: 'int', nullable: true })
  size!: number | null;

  @Column({
    name: 'price',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  price!: string | null;

  @Column({ name: 'type', type: 'varchar', length: 10, nullable: true })
  type!: string | null;

  @Column({ name: 'side', type: 'varchar', length: 10, nullable: true })
  side!: string | null;

  @Column({ name: 'status', type: 'varchar', length: 20, nullable: true })
  status!: string | null;

  @Column({ name: 'datetime', type: 'timestamp', nullable: true })
  datetime!: Date | null;
}
