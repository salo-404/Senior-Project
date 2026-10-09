/**
 * Commission (Domain 11 + Step 7, locked rules):
 *   - commission = hourly labor x tier commission %
 *   - Parts and anything else on the invoice are NEVER commissioned.
 *   - Charged once, when the customer confirms the invoice (= COMPLETED).
 *   - Also applies to the visit fee (it is hourly labor too).
 *   - External technicians: no commission (the caller skips this function).
 */
import { divideRoundHalfUp, formatCents, toHundredths } from './money';
import { PricingError } from './pricing.errors';
import type { CommissionResult } from './pricing.types';

/**
 * @param laborCents        LaborResult.laborCents, or the visit fee in cents
 * @param commissionPercent commission_tiers rate as a percentage, e.g. "10" or "12.5"
 */
export function calculateCommission(laborCents: number, commissionPercent: string | number): CommissionResult {
  if (!Number.isSafeInteger(laborCents) || laborCents < 0) {
    throw new PricingError('INVALID_AMOUNT', 'laborCents must be a non-negative integer');
  }

  let basisPoints: number;
  try {
    basisPoints = toHundredths(commissionPercent, 'commissionPercent');
  } catch {
    throw new PricingError('INVALID_COMMISSION_RATE', 'commissionPercent must be between 0 and 100 with at most 2 decimals');
  }
  if (basisPoints > 10000) {
    throw new PricingError('INVALID_COMMISSION_RATE', 'commissionPercent cannot exceed 100');
  }

  const commissionCents = divideRoundHalfUp(laborCents * basisPoints, 10000);
  const technicianNetLaborCents = laborCents - commissionCents;

  return {
    laborCents,
    commissionBasisPoints: basisPoints,
    commissionCents,
    technicianNetLaborCents,
    commission: formatCents(commissionCents),
    technicianNetLabor: formatCents(technicianNetLaborCents),
  };
}
