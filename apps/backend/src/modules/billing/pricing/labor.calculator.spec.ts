import { calculateLabor, calculateVisitFeeCents, rateTypeForPriority } from './labor.calculator';
import { PricingError } from './pricing.errors';

const rates = { normalRate: '15.00', emergencyRate: '25.00' };

describe('rateTypeForPriority', () => {
  it('uses the emergency rate only for EMERGENCY', () => {
    expect(rateTypeForPriority('EMERGENCY')).toBe('EMERGENCY');
    expect(rateTypeForPriority('URGENT')).toBe('NORMAL');
    expect(rateTypeForPriority('NORMAL')).toBe('NORMAL');
  });
});

describe('calculateLabor', () => {
  it('normal job, 2 h, 1 visit -> 30.00', () => {
    const r = calculateLabor({ hoursWorked: '2', visitCount: 1, rateType: 'NORMAL', rates });
    expect(r.laborCents).toBe(3000);
    expect(r.extraVisits).toBe(0);
    expect(r.extraVisitCents).toBe(0);
  });

  it('normal job, 2 h, 2 visits -> (2 + 1) x 15 = 45.00', () => {
    const r = calculateLabor({ hoursWorked: '2', visitCount: 2, rateType: 'NORMAL', rates });
    expect(r.workCents).toBe(3000);
    expect(r.extraVisitCents).toBe(1500);
    expect(r.laborCents).toBe(4500);
    expect(r.billableCentiHours).toBe(300);
  });

  it('emergency job, 2 h -> 2 x 25 = 50.00', () => {
    const r = calculateLabor({ hoursWorked: 2, visitCount: 1, rateType: 'EMERGENCY', rates });
    expect(r.rateCents).toBe(2500);
    expect(r.laborCents).toBe(5000);
  });

  it('handles partial hours: 1.5 h x 15 = 22.50', () => {
    const r = calculateLabor({ hoursWorked: '1.5', visitCount: 1, rateType: 'NORMAL', rates });
    expect(r.laborCents).toBe(2250);
  });

  it('rounds half-up to the cent: 0.33 h x 15.75 = 5.1975 -> 5.20', () => {
    const r = calculateLabor({
      hoursWorked: '0.33',
      visitCount: 1,
      rateType: 'NORMAL',
      rates: { normalRate: '15.75', emergencyRate: '20' },
    });
    expect(r.laborCents).toBe(520);
  });

  it('has no floating point drift: 0.1 h x 0.30 ... style inputs stay exact', () => {
    const r = calculateLabor({
      hoursWorked: '0.1',
      visitCount: 3,
      rateType: 'NORMAL',
      rates: { normalRate: '0.3', emergencyRate: '1' },
    });
    // work: 0.1 x 0.30 = 0.03 ; extra: 2 x 0.30 = 0.60
    expect(r.workCents).toBe(3);
    expect(r.extraVisitCents).toBe(60);
    expect(r.laborCents).toBe(63);
  });

  it.each([
    ['0', 'INVALID_HOURS'],
    ['-1', 'INVALID_HOURS'],
    ['1.555', 'INVALID_HOURS'],
    ['abc', 'INVALID_HOURS'],
    ['101', 'INVALID_HOURS'],
  ])('rejects hoursWorked "%s"', (hoursWorked, code) => {
    expect(() => calculateLabor({ hoursWorked, visitCount: 1, rateType: 'NORMAL', rates })).toThrow(PricingError);
    try {
      calculateLabor({ hoursWorked, visitCount: 1, rateType: 'NORMAL', rates });
    } catch (e) {
      expect((e as PricingError).code).toBe(code);
    }
  });

  it.each([0, -1, 1.5, 21])('rejects visitCount %p', (visitCount) => {
    expect(() => calculateLabor({ hoursWorked: '1', visitCount, rateType: 'NORMAL', rates })).toThrow(
      'visitCount must be an integer',
    );
  });

  it('rejects a zero or invalid rate', () => {
    expect(() =>
      calculateLabor({ hoursWorked: '1', visitCount: 1, rateType: 'NORMAL', rates: { normalRate: '0', emergencyRate: '25' } }),
    ).toThrow('normalRate must be greater than 0');
    expect(() =>
      calculateLabor({ hoursWorked: '1', visitCount: 1, rateType: 'EMERGENCY', rates: { normalRate: '15', emergencyRate: 'x' } }),
    ).toThrow(PricingError);
  });
});

describe('calculateVisitFeeCents', () => {
  it('is 1 hour of the matching rate', () => {
    expect(calculateVisitFeeCents(rates, 'NORMAL')).toBe(1500);
    expect(calculateVisitFeeCents(rates, 'EMERGENCY')).toBe(2500);
  });
});
