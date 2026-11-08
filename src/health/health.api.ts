import { applyDecorators } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiError, SERVICE_UNAVAILABLE_ERROR } from '../common/error.response';
import { HealthResponse } from './health.response';

export function ApiHealth(): MethodDecorator {
  return applyDecorators(
    ApiTags('Health'),
    ApiOperation({
      summary: 'Readiness check',
      description:
        'Reports whether the service can reach PostgreSQL: it takes a pooled connection and runs `SELECT 1` within a 2-second bound. ' +
        'It is a readiness check, not a liveness check, and exposes no connection details. ' +
        'It is not part of the business API.',
    }),
    ApiOkResponse({
      description: 'The database answered.',
      type: HealthResponse,
    }),
    ApiError(503, 'The database did not answer in time or is unreachable.', [
      SERVICE_UNAVAILABLE_ERROR,
    ]),
  );
}
