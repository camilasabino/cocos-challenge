import { parseDecimal } from '../../common/decimal';
import { resolveQuantity } from './order-sizing';

const price = parseDecimal;

describe('resolveQuantity', () => {
  it('returns an exact size unchanged', () => {
    expect(resolveQuantity({ size: 7 }, price('925.85'))).toBe(7);
  });

  it('floors the amount to whole shares', () => {
    // 10000 / 925.85 = 10.80...
    expect(
      resolveQuantity({ amount: price('10000.00') }, price('925.85')),
    ).toBe(10);
    // 999.99 / 100 = 9.9999 -> never rounds up to 10
    expect(resolveQuantity({ amount: price('999.99') }, price('100.00'))).toBe(
      9,
    );
  });

  it('is exact when the division has no remainder', () => {
    expect(resolveQuantity({ amount: price('0.30') }, price('0.10'))).toBe(3);
    expect(resolveQuantity({ amount: price('1000.00') }, price('250.00'))).toBe(
      4,
    );
  });

  it('returns 0 when the amount is below the price', () => {
    expect(resolveQuantity({ amount: price('925.84') }, price('925.85'))).toBe(
      0,
    );
    expect(resolveQuantity({ amount: price('0') }, price('925.85'))).toBe(0);
  });

  it('buys the maximum quantity allowed by NUMERIC(10,2) inputs', () => {
    expect(
      resolveQuantity({ amount: price('99999999.99') }, price('0.01')),
    ).toBe(9999999999);
  });

  it('rejects invalid inputs', () => {
    expect(() => resolveQuantity({ size: 0 }, price('1'))).toThrow(RangeError);
    expect(() => resolveQuantity({ size: 1.5 }, price('1'))).toThrow(
      RangeError,
    );
    expect(() => resolveQuantity({ amount: price('10') }, price('0'))).toThrow(
      RangeError,
    );
    expect(() => resolveQuantity({ amount: price('10') }, price('-1'))).toThrow(
      RangeError,
    );
    expect(() => resolveQuantity({ amount: price('-10') }, price('1'))).toThrow(
      RangeError,
    );
  });
});
