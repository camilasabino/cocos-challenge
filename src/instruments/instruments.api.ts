import { applyDecorators } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiError, SERVICE_UNAVAILABLE_ERROR } from '../common/error.response';
import { InstrumentResponse } from './instrument.response';

export function ApiSearchInstruments(): MethodDecorator {
  return applyDecorators(
    ApiTags('Instruments'),
    ApiOperation({
      summary: 'Search instruments by ticker or name',
      description:
        'Case-insensitive substring match on `ticker` OR `name` (`%`, `_` and `\\` in `q` are matched literally). ' +
        'Results are ordered by relevance: exact ticker match, then ticker prefix, then any other match; ties by ticker. ' +
        'Cash (`MONEDA`) instruments are never returned. ' +
        'No match is not an error: the response is `200` with an empty array.',
    }),
    ApiOkResponse({
      description: 'Matching instruments (possibly none).',
      type: InstrumentResponse,
      isArray: true,
    }),
    ApiError(
      400,
      'Invalid query: `q` missing/blank/longer than 50 characters, `limit` outside 1–50 or not an integer, or an unknown query parameter.',
      [
        {
          summary: 'Invalid query parameters',
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: [
            {
              field: 'q',
              message: 'q must be longer than or equal to 1 characters',
            },
          ],
        },
      ],
    ),
    ApiError(503, 'PostgreSQL is temporarily unavailable.', [
      SERVICE_UNAVAILABLE_ERROR,
    ]),
  );
}
