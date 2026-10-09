export type PricingErrorCode =
  | 'INVALID_AMOUNT'
  | 'INVALID_HOURS'
  | 'INVALID_VISIT_COUNT'
  | 'INVALID_RATE'
  | 'INVALID_COMMISSION_RATE'
  | 'INVALID_PART';

/**
 * Thrown by the pure pricing functions. The HTTP layer (Part B) maps it to
 * 422 { error: { code, message } }.
 */
export class PricingError extends Error {
  readonly code: PricingErrorCode;

  constructor(code: PricingErrorCode, message: string) {
    super(message);
    this.name = 'PricingError';
    this.code = code;
  }
}
