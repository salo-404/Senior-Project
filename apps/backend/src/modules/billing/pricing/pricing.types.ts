import type { Cents } from './money';

/** Which of the technician's two hourly rates applies. */
export type RateType = 'NORMAL' | 'EMERGENCY';

/** Rates as stored on technician_profiles (Decimal(10,2) -> string). */
export interface TechnicianRates {
  normalRate: string | number;
  emergencyRate: string | number;
}

export interface LaborInput {
  /** Actual hours worked across all visits, max 2 decimals (e.g. "2", "1.5"). */
  hoursWorked: string | number;
  /** assignments.visit_count - 1 on "Start job", +1 on every "Resume job". */
  visitCount: number;
  rateType: RateType;
  rates: TechnicianRates;
}

export interface LaborResult {
  rateType: RateType;
  rateCents: Cents;
  /** Hours worked x 100 (e.g. 1.5 h -> 150). */
  workedCentiHours: number;
  /** visitCount - 1. Each extra visit is billed as 1 extra hour. */
  extraVisits: number;
  /** workedCentiHours + extraVisits x 100. */
  billableCentiHours: number;
  workCents: Cents;
  extraVisitCents: Cents;
  /** workCents + extraVisitCents. The ONLY base for commission. */
  laborCents: Cents;
}

export interface PartLine {
  description: string;
  /** Unit cost, max 2 decimals. */
  unitCost: string | number;
  /** Defaults to 1. */
  quantity?: number;
}

export type InvoiceLineKind = 'LABOR' | 'EXTRA_VISIT' | 'VISIT_FEE' | 'PART';

export interface InvoiceLine {
  kind: InvoiceLineKind;
  description: string;
  amountCents: Cents;
  /** Same amount formatted for display, e.g. "45.00". */
  amount: string;
}

/** What the customer sees and confirms. Commission is NEVER on it. */
export interface Invoice {
  lines: InvoiceLine[];
  laborCents: Cents;
  partsCents: Cents;
  totalCents: Cents;
  labor: string;
  parts: string;
  total: string;
}

export interface CommissionResult {
  laborCents: Cents;
  /** Tier commission % in basis points (10% -> 1000). */
  commissionBasisPoints: number;
  commissionCents: Cents;
  technicianNetLaborCents: Cents;
  commission: string;
  technicianNetLabor: string;
}
