import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'marketdata' })
export class MarketData {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'instrumentid', type: 'int', nullable: true })
  instrumentId!: number | null;

  @Column({
    name: 'high',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  high!: string | null;

  @Column({
    name: 'low',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  low!: string | null;

  @Column({
    name: 'open',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  open!: string | null;

  @Column({
    name: 'close',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  close!: string | null;

  @Column({
    name: 'previousclose',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  previousClose!: string | null;

  @Column({ name: 'date', type: 'date', nullable: true })
  date!: string | null;
}
