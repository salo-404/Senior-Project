/**
 * Exact money math for maintAIn.
 *
 * All amounts are handled as INTEGER CENTS (e.g. $45.50 -> 4550). JavaScript
 * floating point is never used for money (0.1 + 0.2 !== 0.3).
 *
 * Inputs arrive as strings ("15.00", from Prisma Decimal.toString() or a DTO)
 * or as numbers with at most 2 decimals. Anything else is rejected.
 */
import { PricingError } from './pricing.errors';

/** Integer number of cents (or centi-hours, or basis points). */
export type Cents = number;

const TWO_DECIMALS = /^\d+(\.\d{1,2})?$/;

/**
 * Parses a non-negative value with at most 2 decimals into an integer scaled
 * by 100. Used for money ("15.75" -> 1575 cents), hours ("1.5" -> 150
 * centi-hours) and percentages ("12.5" -> 1250 basis points).
 */
export function toHundredths(value: string | number, field: string): number {
  const text = typeof value === 'number' ? numberToText(value, field) : value.trim();
  if (!TWO_DECIMALS.test(text)) {
    throw new PricingError(
      'INVALID_AMOUNT',
      `${field} must be a non-negative number with at most 2 decimals (got "${String(value)}")`,
    );
  }
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) {
    throw new PricingError('INVALID_AMOUNT', `${field} is too large`);
  }
  return result;
}

/** "15.75" -> 1575 */
export function toCents(value: string | number, field = 'amount'): Cents {
  return toHundredths(value, field);
}

/** 1575 -> "15.75" (for API responses and the invoice). */
export function formatCents(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  return `${sign}${whole}.${fraction}`;
}

/**
 * Integer division rounded half-up (0.5 -> 1). Both arguments must be
 * non-negative safe integers and the divisor must be > 0.
 */
export function divideRoundHalfUp(dividend: number, divisor: number): number {
  if (!Number.isSafeInteger(dividend) || !Number.isSafeInteger(divisor) || dividend < 0 || divisor <= 0) {
    throw new PricingError('INVALID_AMOUNT', 'divideRoundHalfUp expects non-negative safe integers');
  }
  return Math.floor((2 * dividend + divisor) / (2 * divisor));
}

function numberToText(value: number, field: string): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new PricingError('INVALID_AMOUNT', `${field} must be a finite non-negative number`);
  }
  // Round to 6 places to drop float noise (e.g. 1.1 * 3), then check <= 2 decimals.
  const text = String(Number(value.toFixed(6)));
  return text;
}
