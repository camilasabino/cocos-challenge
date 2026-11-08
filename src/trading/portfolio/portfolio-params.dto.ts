import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/** Largest value of the `users.id` INT column; anything above cannot exist. */
export const MAX_USER_ID = 2147483647;

export class PortfolioParamsDto {
  // Only plain digit strings become numbers; anything else ("1.5", "1e3",
  // "-1", "abc") is left as-is so that @IsInt rejects it instead of coercing.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(MAX_USER_ID)
  userId!: number;
}
