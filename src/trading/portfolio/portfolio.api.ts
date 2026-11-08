import { applyDecorators } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiError,
  SERVICE_UNAVAILABLE_ERROR,
} from '../../common/error.response';
import { PortfolioResponse } from './portfolio.response';

const portfolioExample = {
  userId: 1,
  totalAccountValue: '1857690.00',
  cashBalance: '1609400.00',
  availableCash: '1585400.00',
  valuationComplete: true,
  unpricedInstrumentIds: [],
  positions: [
    {
      instrumentId: 5,
      ticker: 'LUMI',
      name: 'Lumina Telecom S.A.',
      quantity: 50,
      lastPrice: '1775.50',
      marketValue: '88775.00',
      averageCost: '1790.00',
      totalReturnPercent: '-0.81',
      dailyPriceChangePercent: '-1.36',
    },
    {
      instrumentId: 6,
      ticker: 'MARB',
      name: 'Banco del Mar S.A.',
      quantity: 20,
      lastPrice: '3250.75',
      marketValue: '65015.00',
      averageCost: '3150.00',
      totalReturnPercent: '3.20',
      dailyPriceChangePercent: '1.59',
    },
    {
      instrumentId: 2,
      ticker: 'NRTE',
      name: 'Norte Energía S.A.',
      quantity: 90,
      lastPrice: '1050.00',
      marketValue: '94500.00',
      averageCost: '1003.33',
      totalReturnPercent: '4.65',
      dailyPriceChangePercent: '2.94',
    },
  ],
};

const oversoldExample = {
  userId: 3,
  totalAccountValue: '500445.00',
  cashBalance: '518200.00',
  availableCash: '518200.00',
  valuationComplete: true,
  unpricedInstrumentIds: [],
  positions: [
    {
      instrumentId: 5,
      ticker: 'LUMI',
      name: 'Lumina Telecom S.A.',
      quantity: -10,
      lastPrice: '1775.50',
      marketValue: '-17755.00',
      averageCost: null,
      totalReturnPercent: null,
      dailyPriceChangePercent: '-1.36',
    },
  ],
};

const unpricedExample = {
  userId: 4,
  totalAccountValue: null,
  cashBalance: '100000.00',
  availableCash: '100000.00',
  valuationComplete: false,
  unpricedInstrumentIds: [7],
  positions: [
    {
      instrumentId: 7,
      ticker: 'TERR',
      name: 'Terra Inmobiliaria S.A.',
      quantity: 10,
      lastPrice: null,
      marketValue: null,
      averageCost: '500.00',
      totalReturnPercent: null,
      dailyPriceChangePercent: null,
    },
  ],
};

export function ApiGetPortfolio(): MethodDecorator {
  return applyDecorators(
    ApiTags('Portfolio'),
    ApiExtraModels(PortfolioResponse),
    ApiOperation({
      summary: "Get a user's portfolio",
      description:
        "Account value, cash and positions computed from the user's `orders`, read from one consistent snapshot. " +
        'All monetary values and percentages are **decimal strings** rounded half-up to 2 decimals; they are never JSON numbers. ' +
        'FILLED orders drive cash and positions; open `NEW` BUY orders only reduce `availableCash` (they reserve cash). ' +
        'If a held instrument has no market price, its price-derived fields and `totalAccountValue` are `null` and `valuationComplete` is `false`.',
    }),
    ApiOkResponse({
      description: 'The portfolio.',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/PortfolioResponse' },
          examples: {
            active: {
              summary: 'Account with positions and a reservation',
              value: portfolioExample,
            },
            oversold: {
              summary: 'Historical negative position (null cost fields)',
              value: oversoldExample,
            },
            unpriced: {
              summary: 'Held instrument without market data (null total)',
              value: unpricedExample,
            },
          },
        },
      },
    }),
    ApiError(400, '`userId` is not a positive integer.', [
      {
        summary: 'Invalid path parameter',
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [
          { field: 'userId', message: 'userId must not be less than 1' },
        ],
      },
    ]),
    ApiError(404, 'The user does not exist.', [
      {
        summary: 'Unknown user',
        code: 'USER_NOT_FOUND',
        message: 'User 9999 not found',
      },
    ]),
    ApiError(503, 'PostgreSQL is temporarily unavailable.', [
      SERVICE_UNAVAILABLE_ERROR,
    ]),
  );
}
