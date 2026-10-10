import { NotFoundException } from '@nestjs/common';
import { NotificationPriority, NotificationType, RequestPriority, RequestStatus, Role } from '@prisma/client';
import { RequestsService } from './requests.service';

const customer = { id: 'cust-1', roles: [Role.CUSTOMER] };

function setup(found: unknown = { id: 'r1', title: 'AC smoking', status: RequestStatus.NEW, priority: RequestPriority.NORMAL, is_safety_escalated: false }, escalated = true) {
  const tx = {};
  const prisma = {
    maintenanceRequest: { findFirst: jest.fn().mockResolvedValue(found) },
    runInTransaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  };
  const lifecycle = { escalate: jest.fn().mockResolvedValue(escalated) };
  const notifications = { notifyRole: jest.fn().mockResolvedValue(1) };
  const noop = {} as never;
  const service = new RequestsService(prisma as never, noop, lifecycle as never, noop, noop, noop, noop, notifications as never, noop);
  return { service, prisma, tx, lifecycle, notifications };
}

describe('RequestsService.confirmSafety', () => {
  it('a clear "yes" escalates through the existing path (raising the priority) and notifies every dispatcher after commit', async () => {
    const { service, tx, lifecycle, notifications } = setup();
    const result = await service.confirmSafety(customer, 'r1', 'yes');

    expect(lifecycle.escalate).toHaveBeenCalledWith(tx, 'r1', customer.id, 'Customer confirmed a safety danger', { raisePriority: true });
    expect(result).toEqual({ id: 'r1', escalated: true, priority: RequestPriority.EMERGENCY, changed: true });
    expect(notifications.notifyRole).toHaveBeenCalledWith(
      Role.DISPATCHER,
      NotificationType.SAFETY_ESCALATED,
      expect.objectContaining({ requestId: 'r1', priority: NotificationPriority.URGENT }),
    );
  });

  it('"no" does nothing at all: no escalation, no notification, no transaction', async () => {
    const { service, prisma, lifecycle, notifications } = setup();
    const result = await service.confirmSafety(customer, 'r1', 'no');
    expect(result).toEqual({ id: 'r1', escalated: false, priority: RequestPriority.NORMAL, changed: false });
    expect(lifecycle.escalate).not.toHaveBeenCalled();
    expect(prisma.runInTransaction).not.toHaveBeenCalled();
    expect(notifications.notifyRole).not.toHaveBeenCalled();
  });

  it('answering "yes" again changes nothing and does not notify twice', async () => {
    const { service, notifications } = setup({ id: 'r1', title: 'AC smoking', status: RequestStatus.NEW, priority: RequestPriority.EMERGENCY, is_safety_escalated: true }, false);
    const result = await service.confirmSafety(customer, 'r1', 'yes');
    expect(result.changed).toBe(false);
    expect(notifications.notifyRole).not.toHaveBeenCalled();
  });

  it.each([RequestStatus.COMPLETED, RequestStatus.CANCELLED, RequestStatus.REJECTED])('refuses a "yes" on a %s case', async (status) => {
    const { service, lifecycle } = setup({ id: 'r1', title: 't', status, priority: RequestPriority.NORMAL, is_safety_escalated: false });
    await expect(service.confirmSafety(customer, 'r1', 'yes')).rejects.toMatchObject({ code: 'CASE_CLOSED', status: 409 });
    expect(lifecycle.escalate).not.toHaveBeenCalled();
  });

  it('only the owning customer can answer: someone else\'s request is a 404', async () => {
    const { service, prisma, lifecycle } = setup(null);
    await expect(service.confirmSafety(customer, 'r1', 'yes')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.maintenanceRequest.findFirst.mock.calls[0][0].where).toEqual({ id: 'r1', customer_id: customer.id });
    expect(lifecycle.escalate).not.toHaveBeenCalled();
  });
});
