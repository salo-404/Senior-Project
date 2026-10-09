import { buildJobInvoice, buildVisitFeeInvoice } from './invoice.builder';
import { calculateLabor, calculateVisitFeeCents } from './labor.calculator';
import { PricingError } from './pricing.errors';

const rates = { normalRate: '15.00', emergencyRate: '25.00' };

describe('buildJobInvoice', () => {
  it('matches the agreed example: 2 h + 1 extra visit + capacitor = 57.00', () => {
    const labor = calculateLabor({ hoursWorked: '2', visitCount: 2, rateType: 'NORMAL', rates });
    const invoice = buildJobInvoice(labor, [{ description: 'Capacitor 35uF', unitCost: '12.00' }]);

    expect(invoice.lines.map((l) => [l.kind, l.amount])).toEqual([
      ['LABOR', '30.00'],
      ['EXTRA_VISIT', '15.00'],
      ['PART', '12.00'],
    ]);
    expect(invoice.labor).toBe('45.00');
    expect(invoice.parts).toBe('12.00');
    expect(invoice.total).toBe('57.00');
    expect(invoice.lines[0].description).toBe('Labor: 2 h x 15.00 (normal rate)');
    expect(invoice.lines[1].description).toBe('Extra visits: 1 x 1 h x 15.00');
  });

  it('omits the extra-visit line when there was only one visit', () => {
    const labor = calculateLabor({ hoursWorked: '1.5', visitCount: 1, rateType: 'NORMAL', rates });
    const invoice = buildJobInvoice(labor);
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines[0].description).toBe('Labor: 1.50 h x 15.00 (normal rate)');
    expect(invoice.total).toBe('22.50');
  });

  it('multiplies part quantity', () => {
    const labor = calculateLabor({ hoursWorked: '1', visitCount: 1, rateType: 'EMERGENCY', rates });
    const invoice = buildJobInvoice(labor, [{ description: 'Filter', unitCost: '6.25', quantity: 2 }]);
    expect(invoice.parts).toBe('12.50');
    expect(invoice.total).toBe('37.50');
    expect(invoice.lines[1].description).toBe('Filter (2 x 6.25)');
  });

  it('labor on the invoice equals the commission base', () => {
    const labor = calculateLabor({ hoursWorked: '3.25', visitCount: 3, rateType: 'NORMAL', rates });
    const invoice = buildJobInvoice(labor, [{ description: 'Gas refill', unitCost: '40' }]);
    expect(invoice.laborCents).toBe(labor.laborCents);
    expect(invoice.totalCents).toBe(labor.laborCents + 4000);
  });

  it.each([
    [{ description: '', unitCost: '5' }],
    [{ description: 'Pipe', unitCost: '-5' }],
    [{ description: 'Pipe', unitCost: '5.001' }],
    [{ description: 'Pipe', unitCost: '5', quantity: 0 }],
  ])('rejects invalid part %p', (part) => {
    const labor = calculateLabor({ hoursWorked: '1', visitCount: 1, rateType: 'NORMAL', rates });
    expect(() => buildJobInvoice(labor, [part])).toThrow(PricingError);
  });
});

describe('buildVisitFeeInvoice', () => {
  it('normal visit fee = 15.00', () => {
    const invoice = buildVisitFeeInvoice(calculateVisitFeeCents(rates, 'NORMAL'), 'NORMAL');
    expect(invoice.lines).toEqual([
      { kind: 'VISIT_FEE', description: 'Visit fee: 1 h x 15.00 (normal rate)', amountCents: 1500, amount: '15.00' },
    ]);
    expect(invoice.laborCents).toBe(1500);
    expect(invoice.total).toBe('15.00');
  });

  it('emergency visit fee = 25.00', () => {
    expect(buildVisitFeeInvoice(calculateVisitFeeCents(rates, 'EMERGENCY'), 'EMERGENCY').total).toBe('25.00');
  });

  it('rejects a zero fee', () => {
    expect(() => buildVisitFeeInvoice(0, 'NORMAL')).toThrow(PricingError);
  });
});
