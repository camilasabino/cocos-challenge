import { applyDecorators } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
} from '@nestjs/swagger';

/** Documentation model of `ErrorBody` (a TypeScript interface has no runtime schema). */
export class ValidationErrorDetail {
  @ApiProperty({ example: 'userId' })
  field!: string;

  @ApiProperty({ example: 'userId must not be less than 1' })
  message!: string;
}

export class ErrorResponse {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({
    description: 'Stable, machine-readable error code.',
    example: 'VALIDATION_ERROR',
  })
  code!: string;

  @ApiProperty({ example: 'Validation failed' })
  message!: string;

  @ApiPropertyOptional({
    type: [ValidationErrorDetail],
    description:
      'Present only on VALIDATION_ERROR: one entry per invalid field.',
  })
  details?: ValidationErrorDetail[];
}

export interface ErrorExample {
  summary: string;
  code: string;
  message: string;
  details?: ValidationErrorDetail[];
}

export function ApiError(
  status: number,
  description: string,
  examples: ErrorExample[],
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiExtraModels(ErrorResponse),
    ApiResponse({
      status,
      description,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ErrorResponse' },
          examples: Object.fromEntries(
            examples.map(({ summary, code, message, details }) => [
              code,
              {
                summary,
                value: {
                  statusCode: status,
                  code,
                  message,
                  ...(details && { details }),
                },
              },
            ]),
          ),
        },
      },
    }),
  );
}

export const SERVICE_UNAVAILABLE_ERROR: ErrorExample = {
  summary:
    'PostgreSQL unreachable, connection lost, pool exhausted or lock wait timed out',
  code: 'SERVICE_UNAVAILABLE',
  message: 'The service is temporarily unavailable',
};
