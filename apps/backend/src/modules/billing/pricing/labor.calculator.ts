/**
 * Labor pricing (Step 7, locked rules):
 *   - Each technician has two hourly rates: normal and emergency.
 *   - The rate is chosen from the request priority (EMERGENCY -> emergency rate).
 *   - Every extra visit (visit_count - 1) is billed as 1 extra hour.
 *   - labor = hours_worked x rate + extra_visits x 1 h x rate
 *   - Visit fee (customer cancels during IN_PROGRESS) = 1 hour of the rate.
 */
import { divideRoundHalfUp, toCents, toHundredths } from './money';
import { PricingError } from './pricing.errors';
import type { LaborInput, LaborResult, RateType, TechnicianRates } from './pricing.types';

/** Sanity limits - protect against typos like 200 hours instead of 2.00. */
export const MAX_HOURS_WORKED = 100;
export const MAX_VISITS = 20;

/** Request priority -> rate type. Only EMERGENCY uses the emergency rate. */
export function rateTypeForPriority(priority: string): RateType {
  return priority === 'EMERGENCY' ? 'EMERGENCY' : 'NORMAL';
}

export function resolveRateCents(rates: TechnicianRates, rateType: RateType): number {
  const raw = rateType === 'EMERGENCY' ? rates.emergencyRate : rates.normalRate;
  const field = rateType === 'EMERGENCY' ? 'emergencyRate' : 'normalRate';
  let cents: number;
  try {
    cents = toCents(raw, field);
  } catch {
    throw new PricingError('INVALID_RATE', `${field} must be a positive amount with at most 2 decimals`);
  }
  if (cents <= 0) {
    throw new PricingError('INVALID_RATE', `${field} must be greater than 0`);
  }
  return cents;
}

export function calculateLabor(input: LaborInput): LaborResult {
  const { visitCount, rateType, rates } = input;

  let workedCentiHours: number;
  try {
    workedCentiHours = toHundredths(input.hoursWorked, 'hoursWorked');
  } catch {
    throw new PricingError('INVALID_HOURS', 'hoursWorked must be a number with at most 2 decimals');
  }
  if (workedCentiHours <= 0) {
    throw new PricingError('INVALID_HOURS', 'hoursWorked must be greater than 0');
  }
  if (workedCentiHours > MAX_HOURS_WORKED * 100) {
    throw new PricingError('INVALID_HOURS', `hoursWorked cannot exceed ${MAX_HOURS_WORKED}`);
  }

  if (!Number.isInteger(visitCount) || visitCount < 1 || visitCount > MAX_VISITS) {
    throw new PricingError('INVALID_VISIT_COUNT', `visitCount must be an integer between 1 and ${MAX_VISITS}`);
  }

  const rateCents = resolveRateCents(rates, rateType);
  const extraVisits = visitCount - 1;

  // hours (x100) x rate (cents) / 100 -> cents, rounded half-up once.
  const workCents = divideRoundHalfUp(workedCentiHours * rateCents, 100);
  // Whole hours x rate: always exact, no rounding needed.
  const extraVisitCents = extraVisits * rateCents;

  return {
    rateType,
    rateCents,
    workedCentiHours,
    extraVisits,
    billableCentiHours: workedCentiHours + extraVisits * 100,
    workCents,
    extraVisitCents,
    laborCents: workCents + extraVisitCents,
  };
}

/** Visit fee = 1 hour of the technician's rate for this request's priority. */
export function calculateVisitFeeCents(rates: TechnicianRates, rateType: RateType): number {
  return resolveRateCents(rates, rateType);
}
