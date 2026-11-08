import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export const MAX_USER_ID = 2147483647;

export class PortfolioParamsDto {
  // Anything but plain digits is left as-is so @IsInt rejects it instead of coercing.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(MAX_USER_ID)
  userId!: number;
}
