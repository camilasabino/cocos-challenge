import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;
export const MAX_QUERY_LENGTH = 50;

export class SearchInstrumentsDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, MAX_QUERY_LENGTH)
  q!: string;

  // Only plain digit strings become numbers; anything else ("1.5", "1e1", "")
  // is left as-is so that @IsInt rejects it instead of being silently coerced.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SEARCH_LIMIT)
  limit: number = DEFAULT_SEARCH_LIMIT;
}
