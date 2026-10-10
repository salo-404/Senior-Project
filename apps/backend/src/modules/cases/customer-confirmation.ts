/** What the dispatcher sees about the customer's answer to the summary. The dispatcher is never blocked by it. */
export type ConfirmationStatus = 'NOT_CONFIRMED' | 'CONFIRMED' | 'CORRECTED';

export interface CustomerConfirmation {
  status: ConfirmationStatus;
  confirmed_at: Date | null;
  /** The customer's correction; only present when status is CORRECTED. */
  note: string | null;
}

/**
 * Derived from the two columns maintenance_cases already has (customer_confirmed_at, customer_note):
 * a note means the customer corrected the summary, a timestamp alone means they confirmed it, neither means they have not answered.
 */
export function confirmationOf(
  row: { customer_confirmed_at: Date | null; customer_note: string | null } | null | undefined,
): CustomerConfirmation {
  if (!row || !row.customer_confirmed_at) return { status: 'NOT_CONFIRMED', confirmed_at: null, note: null };
  if (row.customer_note) return { status: 'CORRECTED', confirmed_at: row.customer_confirmed_at, note: row.customer_note };
  return { status: 'CONFIRMED', confirmed_at: row.customer_confirmed_at, note: null };
}
