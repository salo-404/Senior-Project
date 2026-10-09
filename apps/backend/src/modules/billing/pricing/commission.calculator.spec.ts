import { calculateCommission } from './commission.calculator';
import { PricingError } from './pricing.errors';

describe('calculateCommission', () => {
  it('Silver 10% on 45.00 labor -> 4.50, technician keeps 40.50', () => {
    const r = calculateCommission(4500, '10');
    expect(r.commissionCents).toBe(450);
    expect(r.technicianNetLaborCents).toBe(4050);
    expect(r.commission).toBe('4.50');
    expect(r.technicianNetLabor).toBe('40.50');
  });

  it('emergency 50.00 at 10% -> 5.00', () => {
    expect(calculateCommission(5000, 10).commissionCents).toBe(500);
  });

  it('visit fee 15.00 at 10% -> 1.50', () => {
    expect(calculateCommission(1500, '10.00').commissionCents).toBe(150);
  });

  it('rounds half-up: 33.33 at 12.5% = 4.16625 -> 4.17', () => {
    const r = calculateCommission(3333, '12.5');
    expect(r.commissionBasisPoints).toBe(1250);
    expect(r.commissionCents).toBe(417);
    expect(r.technicianNetLaborCents).toBe(2916);
  });

  it('0% commission -> 0', () => {
    expect(calculateCommission(4500, 0).commissionCents).toBe(0);
  });

  it('commission + technician net always equals labor', () => {
    for (const labor of [1, 99, 1234, 4500, 99999]) {
      for (const pct of ['5', '7.5', '10', '12.25', '15']) {
        const r = calculateCommission(labor, pct);
        expect(r.commissionCents + r.technicianNetLaborCents).toBe(labor);
      }
    }
  });

  it.each(['101', '-5', '10.555', 'ten'])('rejects commissionPercent "%s"', (pct) => {
    expect(() => calculateCommission(4500, pct)).toThrow(PricingError);
  });

  it('rejects invalid labor', () => {
    expect(() => calculateCommission(-1, '10')).toThrow(PricingError);
    expect(() => calculateCommission(10.5, '10')).toThrow(PricingError);
  });
});
