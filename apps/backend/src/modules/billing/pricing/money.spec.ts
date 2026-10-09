import { divideRoundHalfUp, formatCents, toCents } from './money';
import { PricingError } from './pricing.errors';

describe('money helpers', () => {
  it.each([
    ['15', 1500],
    ['15.5', 1550],
    ['15.75', 1575],
    ['0.01', 1],
    [' 7.10 ', 710],
    [12.3, 1230],
  ])('toCents(%p) -> %p', (input, cents) => {
    expect(toCents(input)).toBe(cents);
  });

  it.each(['', '1.234', '-1', '1,5', 'abc', '1e3'])('toCents rejects %p', (input) => {
    expect(() => toCents(input)).toThrow(PricingError);
  });

  it('formats cents', () => {
    expect(formatCents(0)).toBe('0.00');
    expect(formatCents(5)).toBe('0.05');
    expect(formatCents(5700)).toBe('57.00');
    expect(formatCents(-150)).toBe('-1.50');
  });

  it('rounds half up', () => {
    expect(divideRoundHalfUp(5, 10)).toBe(1);
    expect(divideRoundHalfUp(4, 10)).toBe(0);
    expect(divideRoundHalfUp(15, 10)).toBe(2);
    expect(divideRoundHalfUp(0, 10)).toBe(0);
  });
});
