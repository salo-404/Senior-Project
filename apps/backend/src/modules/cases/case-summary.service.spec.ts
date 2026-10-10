import { NotFoundException } from '@nestjs/common';
import { AuditAction, NotificationType, RequestStatus, Role } from '@prisma/client';
import { SafetyService } from '../../infra/safety/safety.service';
import { CaseSummaryService } from './case-summary.service';
import { confirmationOf } from './customer-confirmation';

const customer = { id: 'cust-1', roles: [Role.CUSTOMER] };

const request = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  title: 'AC not cooling',
  description: 'Blows warm air since yesterday.',
  status: RequestStatus.UNDER_REVIEW,
  language: 'en',
  problem_type: 'NOT_COOLING',
  intake_answers: { safety_concern: false, symptoms: ['warm air'] },
  is_safety_escalated: false,
  equipment: { name: 'Living room AC', brand: 'Acme', model: 'X1', equipment_type: { name: 'Split air conditioner', category: 'HVAC' } },
  case: { id: 'c1', summary: 'AC blows warm air', symptoms: ['warm air', 'noise'], customer_confirmed_at: null, customer_note: null },
  ...over,
});

function setup(found: unknown = request()) {
  const tx = { maintenanceRequest: { findFirst: jest.fn().mockResolvedValue(found) }, maintenanceCase: { update: jest.fn() } };
  const prisma = { maintenanceRequest: { findFirst: jest.fn().mockResolvedValue(found) }, runInTransaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const notifications = { notifyRole: jest.fn().mockResolvedValue(1) };
  const service = new CaseSummaryService(prisma as never, audit as never, new SafetyService(), notifications as never);
  return { service, prisma, tx, audit, notifications };
}

describe('confirmationOf', () => {
  it('is NOT_CONFIRMED, CONFIRMED or CORRECTED depending on the two columns', () => {
    const at = new Date();
    expect(confirmationOf(null).status).toBe('NOT_CONFIRMED');
    expect(confirmationOf({ customer_confirmed_at: null, customer_note: null }).status).toBe('NOT_CONFIRMED');
    expect(confirmationOf({ customer_confirmed_at: at, customer_note: null })).toEqual({ status: 'CONFIRMED', confirmed_at: at, note: null });
    expect(confirmationOf({ customer_confirmed_at: at, customer_note: 'It is a fridge' })).toEqual({ status: 'CORRECTED', confirmed_at: at, note: 'It is a fridge' });
  });
});

describe('CaseSummaryService.getSummary', () => {
  it('shows the device, the problem, the symptoms and the safety answer, built from the case', async () => {
    const { service, prisma } = setup();
    const summary = await service.getSummary(customer, 'r1');

    expect(prisma.maintenanceRequest.findFirst.mock.calls[0][0].where).toEqual({ id: 'r1', customer_id: customer.id });
    expect(summary).toMatchObject({
      request_id: 'r1',
      source: 'CASE',
      device: { name: 'Living room AC', type: 'Split air conditioner', brand: 'Acme' },
      problem: { title: 'AC not cooling', description: 'AC blows warm air' },
      symptoms: ['warm air', 'noise'],
      safety: { answer: 'NO', escalated: false },
      confirmation: { status: 'NOT_CONFIRMED' },
    });
  });

  it('NEVER selects or returns possible causes, urgency or other AI fields', async () => {
    const { service, prisma } = setup(
      request({ case: { id: 'c1', summary: 's', symptoms: null, customer_confirmed_at: null, customer_note: null, possible_causes: ['gas leak'], urgency_level: 'HIGH' } }),
    );
    const summary = await service.getSummary(customer, 'r1');

    const select = prisma.maintenanceRequest.findFirst.mock.calls[0][0].select;
    expect(Object.keys(select.case.select).sort()).toEqual(['customer_confirmed_at', 'customer_note', 'id', 'summary', 'symptoms']);
    const text = JSON.stringify(summary);
    expect(text).not.toMatch(/possible_causes|urgency|gas leak|HIGH/);
  });

  it('falls back to a template over the form answers when there is no case', async () => {
    const { service } = setup(request({ case: null, intake_answers: { safety_concern: true, symptoms: ['smell'] } }));
    const summary = await service.getSummary(customer, 'r1');
    expect(summary.source).toBe('FORM');
    expect(summary.problem.description).toBe('Blows warm air since yesterday.');
    expect(summary.symptoms).toEqual(['smell']);
    expect(summary.safety.answer).toBe('YES');
    expect(summary.confirmation.status).toBe('NOT_CONFIRMED');
  });

  it('reports NOT_ANSWERED when the form had no safety question, and null symptoms when there are none', async () => {
    const { service } = setup(request({ intake_answers: null, case: { id: 'c1', summary: null, symptoms: null, customer_confirmed_at: null, customer_note: null } }));
    const summary = await service.getSummary(customer, 'r1');
    expect(summary.safety.answer).toBe('NOT_ANSWERED');
    expect(summary.symptoms).toBeNull();
    expect(summary.problem.description).toBe('Blows warm air since yesterday.');
  });

  it('answers 404 for someone else\'s request', async () => {
    const { service } = setup(null);
    await expect(service.getSummary(customer, 'r1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CaseSummaryService.confirm', () => {
  it('confirms: sets only customer_confirmed_at, clears the note, audits CASE_CONFIRMED_BY_CUSTOMER in the same transaction', async () => {
    const { service, tx, audit, notifications } = setup();
    const result = await service.confirm(customer, 'r1', { confirmed: true });

    const update = tx.maintenanceCase.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'c1' });
    // Only these two columns: urgency and safety flags are never touched.
    expect(Object.keys(update.data).sort()).toEqual(['customer_confirmed_at', 'customer_note']);
    expect(update.data.customer_note).toBeNull();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.CASE_CONFIRMED_BY_CUSTOMER, actorId: customer.id, entityType: 'maintenance_case', entityId: 'c1' }),
      tx,
    );
    expect(result.confirmation.status).toBe('CONFIRMED');
    expect(result.safety_check).toBeNull();
    expect(notifications.notifyRole).not.toHaveBeenCalled();
  });

  it('corrects: stores the note, tells the dispatchers, and reports CORRECTED', async () => {
    const { service, tx, notifications } = setup();
    const result = await service.confirm(customer, 'r1', { confirmed: false, note: '  It is actually the fridge.  ' });
    expect(tx.maintenanceCase.update.mock.calls[0][0].data.customer_note).toBe('It is actually the fridge.');
    expect(result.confirmation).toMatchObject({ status: 'CORRECTED', note: 'It is actually the fridge.' });
    expect(notifications.notifyRole).toHaveBeenCalledWith(Role.DISPATCHER, NotificationType.REQUEST_STATUS_CHANGED, expect.any(Object));
  });

  it('a danger keyword in the note returns the fixed question and does NOT escalate by itself', async () => {
    const { service, tx, audit } = setup();
    const result = await service.confirm(customer, 'r1', { confirmed: false, note: 'It also smells like gas near the stove' });

    expect(result.safety_check).toEqual({ categories: ['GAS'], question: 'Can you smell gas right now?' });
    // Nothing but the case row was written; no escalation, no priority or status change.
    expect(Object.keys(tx.maintenanceCase.update.mock.calls[0][0].data).sort()).toEqual(['customer_confirmed_at', 'customer_note']);
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log.mock.calls[0][0].action).toBe(AuditAction.CASE_CONFIRMED_BY_CUSTOMER);
  });

  it('asks the question in Arabic for an Arabic-speaking customer', async () => {
    const { service } = setup(request({ language: 'ar-LB' }));
    const result = await service.confirm(customer, 'r1', { confirmed: false, note: 'في ريحة غاز' });
    expect(result.safety_check?.question).toBe('هل تشم رائحة غاز الآن؟');
  });

  it('refuses a note together with a confirmation, and a correction is checked by the DTO', async () => {
    const { service, prisma } = setup();
    await expect(service.confirm(customer, 'r1', { confirmed: true, note: 'x' })).rejects.toMatchObject({ code: 'NOTE_NOT_ALLOWED' });
    expect(prisma.runInTransaction).not.toHaveBeenCalled();
  });

  it.each([RequestStatus.COMPLETED, RequestStatus.CANCELLED, RequestStatus.REJECTED])('refuses a %s case', async (status) => {
    const { service, tx } = setup(request({ status }));
    await expect(service.confirm(customer, 'r1', { confirmed: true })).rejects.toMatchObject({ code: 'CASE_CLOSED', status: 409 });
    expect(tx.maintenanceCase.update).not.toHaveBeenCalled();
  });

  it('answers 404 for someone else\'s request and for a request without a case, writing nothing', async () => {
    const other = setup(null);
    await expect(other.service.confirm(customer, 'r1', { confirmed: true })).rejects.toBeInstanceOf(NotFoundException);
    expect(other.audit.log).not.toHaveBeenCalled();

    const noCase = setup(request({ case: null }));
    await expect(noCase.service.confirm(customer, 'r1', { confirmed: true })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('can be answered again (the second answer replaces the first, and the audit keeps the old value)', async () => {
    const at = new Date('2026-10-01T10:00:00Z');
    const { service, audit } = setup(request({ case: { id: 'c1', summary: 's', symptoms: null, customer_confirmed_at: at, customer_note: 'first' } }));
    await service.confirm(customer, 'r1', { confirmed: true });
    expect(audit.log.mock.calls[0][0].oldValue).toEqual({ customer_confirmed_at: at.toISOString(), customer_note: 'first' });
  });
});
