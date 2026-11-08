import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PlaceOrderDto } from './place-order.dto';

const base = { userId: 1, instrumentId: 2, side: 'BUY', type: 'MARKET' };

async function errorsFor(body: Record<string, unknown>) {
  const dto = plainToInstance(PlaceOrderDto, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.flatMap((error) =>
    Object.values(error.constraints ?? {}).map(
      (message) => `${error.property}: ${message}`,
    ),
  );
}

const fields = async (body: Record<string, unknown>) => [
  ...new Set((await errorsFor(body)).map((message) => message.split(':')[0])),
];

describe('PlaceOrderDto', () => {
  describe('valid bodies', () => {
    it.each([
      ['MARKET by size', { ...base, size: 10 }],
      ['MARKET by amount', { ...base, amount: '1000.50' }],
      ['LIMIT by size', { ...base, type: 'LIMIT', size: 5, price: '925.50' }],
      [
        'LIMIT by amount',
        { ...base, side: 'SELL', type: 'LIMIT', amount: '100', price: '1' },
      ],
      ['largest size', { ...base, size: 2147483647 }],
      ['largest amount', { ...base, amount: '99999999.99' }],
      [
        'largest price',
        { ...base, type: 'LIMIT', size: 1, price: '99999999.99' },
      ],
      ['smallest price', { ...base, type: 'LIMIT', size: 1, price: '0.01' }],
      ['one-decimal amount', { ...base, amount: '10.5' }],
    ])('accepts %s', async (_name, body) => {
      expect(await errorsFor(body)).toEqual([]);
    });
  });

  describe('size xor amount', () => {
    it('rejects neither', async () => {
      expect(await errorsFor(base)).toEqual([
        'size: exactly one of size or amount is required',
      ]);
    });

    it('rejects both', async () => {
      expect(await errorsFor({ ...base, size: 1, amount: '10.00' })).toEqual([
        'amount: size and amount are mutually exclusive; provide exactly one',
      ]);
    });

    it.each([null, 'abc'])('rejects an invalid size alone (%p)', async (v) => {
      expect(await fields({ ...base, size: v })).toEqual(['size']);
    });

    it('rejects null as a way to "omit" either quantity', async () => {
      expect(await fields({ ...base, size: null, amount: '10.00' })).toEqual([
        'size',
        'amount',
      ]);
      expect(await fields({ ...base, size: 1, amount: null })).toEqual([
        'amount',
      ]);
    });
  });

  describe('size', () => {
    it.each([0, -1, 1.5, 2147483648, '10', true, [], {}, 1e10])(
      'rejects %p',
      async (size) => {
        expect(await fields({ ...base, size })).toEqual(['size']);
      },
    );
  });

  describe('amount and price (money)', () => {
    it.each([
      '0',
      '0.00',
      '-1.00',
      '10.001',
      '99999999.991',
      '100000000.00',
      '1e3',
      '+10',
      ' 10',
      '10 ',
      '10,50',
      '',
      'NaN',
      'Infinity',
      '.5',
      10,
      10.5,
      null,
      true,
    ])('rejects the amount %p', async (amount) => {
      expect(await fields({ ...base, amount })).toEqual(['amount']);
    });

    it.each(['0', '0.00', '-1.00', '10.001', '100000000.00', '1e3', 10, true])(
      'rejects the price %p',
      async (price) => {
        expect(
          await fields({ ...base, type: 'LIMIT', size: 1, price }),
        ).toEqual(['price']);
      },
    );
  });

  describe('price iff LIMIT', () => {
    it('requires a price for LIMIT', async () => {
      expect(await errorsFor({ ...base, type: 'LIMIT', size: 1 })).toEqual([
        'price: price is required for LIMIT orders',
      ]);
    });

    it('rejects a null price for LIMIT', async () => {
      expect(
        await fields({ ...base, type: 'LIMIT', size: 1, price: null }),
      ).toEqual(['price']);
    });

    it.each(['925.50', null, 100])(
      'forbids a price (%p) for MARKET',
      async (price) => {
        expect(await errorsFor({ ...base, size: 1, price })).toEqual([
          'price: price must not be provided for MARKET orders',
        ]);
      },
    );
  });

  describe('ids, side and type', () => {
    it.each([
      ['userId', 0],
      ['userId', -1],
      ['userId', 1.5],
      ['userId', '1'],
      ['userId', 2147483648],
      ['userId', null],
      ['instrumentId', 0],
      ['instrumentId', '2'],
      ['instrumentId', 2147483648],
      ['side', 'CASH_IN'],
      ['side', 'CASH_OUT'],
      ['side', 'buy'],
      ['side', null],
      ['type', 'STOP'],
      ['type', 'market'],
      ['type', 1],
    ])('rejects %s = %p', async (field, value) => {
      expect(await fields({ ...base, size: 1, [field]: value })).toEqual([
        field,
      ]);
    });

    it.each(['userId', 'instrumentId', 'side', 'type'])(
      'requires %s',
      async (field) => {
        const body: Record<string, unknown> = { ...base, size: 1 };
        delete body[field];
        expect(await fields(body)).toEqual([field]);
      },
    );
  });

  it('rejects unknown properties', async () => {
    expect(await fields({ ...base, size: 1, status: 'FILLED' })).toEqual([
      'status',
    ]);
    expect(await fields({ ...base, size: 1, datetime: '2026-01-01' })).toEqual([
      'datetime',
    ]);
  });

  it('reports every problem of a badly broken body at once', async () => {
    expect(await fields({})).toEqual(
      expect.arrayContaining([
        'userId',
        'instrumentId',
        'side',
        'type',
        'size',
      ]),
    );
  });
});
