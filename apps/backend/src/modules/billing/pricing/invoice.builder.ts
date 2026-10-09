/**
 * Builds the customer-facing invoice the customer confirms or disputes.
 * The job only becomes COMPLETED when the customer confirms it.
 * Commission is internal and never appears on the invoice.
 */
import { formatCents, toCents } from './money';
import { PricingError } from './pricing.errors';
import type { Invoice, InvoiceLine, LaborResult, PartLine, RateType } from './pricing.types';

export const MAX_PART_QUANTITY = 100;
export const MAX_PART_LINES = 50;

function hoursText(centiHours: number): string {
  return formatCents(centiHours).replace(/\.00$/, '');
}

function rateLabel(rateType: RateType): string {
  return rateType === 'EMERGENCY' ? 'emergency rate' : 'normal rate';
}

function line(kind: InvoiceLine['kind'], description: string, amountCents: number): InvoiceLine {
  return { kind, description, amountCents, amount: formatCents(amountCents) };
}

function buildPartLines(parts: PartLine[]): InvoiceLine[] {
  if (parts.length > MAX_PART_LINES) {
    throw new PricingError('INVALID_PART', `An invoice can have at most ${MAX_PART_LINES} part lines`);
  }
  return parts.map((part, index) => {
    const description = part.description?.trim();
    if (!description) {
      throw new PricingError('INVALID_PART', `Part #${index + 1} needs a description`);
    }
    const quantity = part.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PART_QUANTITY) {
      throw new PricingError('INVALID_PART', `Part "${description}" quantity must be an integer between 1 and ${MAX_PART_QUANTITY}`);
    }
    let unitCents: number;
    try {
      unitCents = toCents(part.unitCost, 'unitCost');
    } catch {
      throw new PricingError('INVALID_PART', `Part "${description}" cost must be a non-negative amount with at most 2 decimals`);
    }
    const label = quantity > 1 ? `${description} (${quantity} x ${formatCents(unitCents)})` : description;
    return line('PART', label, unitCents * quantity);
  });
}

function totals(lines: InvoiceLine[]): Invoice {
  const partsCents = lines.filter((l) => l.kind === 'PART').reduce((sum, l) => sum + l.amountCents, 0);
  const laborCents = lines.filter((l) => l.kind !== 'PART').reduce((sum, l) => sum + l.amountCents, 0);
  const totalCents = laborCents + partsCents;
  return {
    lines,
    laborCents,
    partsCents,
    totalCents,
    labor: formatCents(laborCents),
    parts: formatCents(partsCents),
    total: formatCents(totalCents),
  };
}

/** Normal completed job: worked hours + extra visits + parts. */
export function buildJobInvoice(labor: LaborResult, parts: PartLine[] = []): Invoice {
  const rate = formatCents(labor.rateCents);
  const lines: InvoiceLine[] = [
    line(
      'LABOR',
      `Labor: ${hoursText(labor.workedCentiHours)} h x ${rate} (${rateLabel(labor.rateType)})`,
      labor.workCents,
    ),
  ];
  if (labor.extraVisits > 0) {
    lines.push(
      line(
        'EXTRA_VISIT',
        `Extra visits: ${labor.extraVisits} x 1 h x ${rate}`,
        labor.extraVisitCents,
      ),
    );
  }
  lines.push(...buildPartLines(parts));
  return totals(lines);
}

/** Customer cancelled during IN_PROGRESS: 1 hour visit fee (+ parts already used, if any). */
export function buildVisitFeeInvoice(visitFeeCents: number, rateType: RateType, parts: PartLine[] = []): Invoice {
  if (!Number.isSafeInteger(visitFeeCents) || visitFeeCents <= 0) {
    throw new PricingError('INVALID_AMOUNT', 'visitFeeCents must be a positive integer');
  }
  const lines: InvoiceLine[] = [
    line('VISIT_FEE', `Visit fee: 1 h x ${formatCents(visitFeeCents)} (${rateLabel(rateType)})`, visitFeeCents),
    ...buildPartLines(parts),
  ];
  return totals(lines);
}
