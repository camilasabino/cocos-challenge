import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;
export const MAX_QUERY_LENGTH = 50;

export class SearchInstrumentsDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ApiProperty({
    description: 'Text to look for in the ticker or the name (trimmed).',
    minLength: 1,
    maxLength: MAX_QUERY_LENGTH,
    example: 'nor',
  })
  @IsString()
  @Length(1, MAX_QUERY_LENGTH)
  q!: string;

  // Anything but plain digits is left as-is so @IsInt rejects it instead of coercing.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @ApiPropertyOptional({
    description: 'Maximum number of results; the best-ranked ones are kept.',
    type: 'integer',
    minimum: 1,
    maximum: MAX_SEARCH_LIMIT,
    default: DEFAULT_SEARCH_LIMIT,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SEARCH_LIMIT)
  limit: number = DEFAULT_SEARCH_LIMIT;
}
