import {
  formatMoney,
  formatPercent,
  isDecimalString,
  parseDecimal,
} from './decimal';

describe('parseDecimal', () => {
  it('parses NUMERIC strings exactly', () => {
    expect(parseDecimal('925.85').toFixed()).toBe('925.85');
    expect(parseDecimal('-0.10').toFixed()).toBe('-0.1');
    expect(parseDecimal('0.10').plus(parseDecimal('0.20')).toFixed()).toBe(
      '0.3',
    );
  });

  it.each(['', 'abc', 'NaN', 'Infinity', '1e3', '+1', '.5', '1.', '1,5', ' 1'])(
    'rejects %j',
    (value) => {
      expect(() => parseDecimal(value)).toThrow('Invalid decimal string');
    },
  );
});

describe('isDecimalString', () => {
  it('validates plain decimal notation', () => {
    expect(isDecimalString('10')).toBe(true);
    expect(isDecimalString('-10.505')).toBe(true);
    expect(isDecimalString('1e3')).toBe(false);
  });

  it('enforces the maximum number of decimals when given', () => {
    expect(isDecimalString('10.25', 2)).toBe(true);
    expect(isDecimalString('10', 2)).toBe(true);
    expect(isDecimalString('10.255', 2)).toBe(false);
  });
});

describe.each([
  ['formatMoney', formatMoney],
  ['formatPercent', formatPercent],
])('%s', (_name, format) => {
  it('rounds HALF_UP to 2 decimals at the boundaries', () => {
    expect(format(parseDecimal('1.004'))).toBe('1.00');
    expect(format(parseDecimal('1.005'))).toBe('1.01');
    expect(format(parseDecimal('1.0049999'))).toBe('1.00');
    expect(format(parseDecimal('2.675'))).toBe('2.68');
  });

  it('rounds ties away from zero for negative values', () => {
    expect(format(parseDecimal('-1.004'))).toBe('-1.00');
    expect(format(parseDecimal('-1.005'))).toBe('-1.01');
    expect(format(parseDecimal('-0.4486'))).toBe('-0.45');
  });

  it('always renders 2 decimals and never negative zero', () => {
    expect(format(parseDecimal('7'))).toBe('7.00');
    expect(format(parseDecimal('0'))).toBe('0.00');
    expect(format(parseDecimal('-0.004'))).toBe('0.00');
  });
});
