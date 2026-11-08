import { ApiProperty } from '@nestjs/swagger';

export class InstrumentResponse {
  @ApiProperty({ example: 2 })
  id!: number;

  @ApiProperty({ type: String, nullable: true, example: 'NRTE' })
  ticker!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Norte Energía S.A.' })
  name!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'ACCIONES' })
  type!: string | null;
}
