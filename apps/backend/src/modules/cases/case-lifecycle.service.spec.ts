import { NotFoundException } from '@nestjs/common';
import { AuditAction, RequestStatus } from '@prisma/client';
import { ALLOWED_TRANSITIONS, CaseLifecycleService } from './case-lifecycle.service';

const S = RequestStatus;

function setup(currentStatus: RequestStatus | null = S.NEW, updateCount = 1) {
  const tx = {
    maintenanceRequest: {
      findUnique: jest.fn().mockResolvedValue(currentStatus ? { status: currentStatus } : null),
      updateMany: jest.fn().mockResolvedValue({ count: updateCount }),
    },
    requestStatusHistory: { create: jest.fn().mockResolvedValue({}) },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return { service: new CaseLifecycleService(audit as never), tx, audit };
}

describe('CaseLifecycleService', () => {
  describe('transition table', () => {
    it('matches the documented lifecycle', () => {
      expect(ALLOWED_TRANSITIONS[S.NEW]).toEqual([S.UNDER_REVIEW, S.CANCELLED]);
      expect(ALLOWED_TRANSITIONS[S.UNDER_REVIEW]).toEqual([S.REQUIRES_FOLLOW_UP, S.APPROVED, S.REJECTED, S.CANCELLED]);
      expect(ALLOWED_TRANSITIONS[S.REQUIRES_FOLLOW_UP]).toEqual([S.UNDER_REVIEW, S.CANCELLED]);
      expect(ALLOWED_TRANSITIONS[S.APPROVED]).toEqual([S.ASSIGNED, S.CANCELLED]);
      expect(ALLOWED_TRANSITIONS[S.ASSIGNED]).toEqual([S.IN_PROGRESS, S.APPROVED, S.CANCELLED]);
    });

    it('has no way out of the terminal statuses, and a customer cannot cancel work in progress', () => {
      for (const terminal of [S.COMPLETED, S.CANCELLED, S.REJECTED]) {
        expect(ALLOWED_TRANSITIONS[terminal]).toEqual([]);
      }
      expect(ALLOWED_TRANSITIONS[S.IN_PROGRESS]).toEqual([S.COMPLETED]);
    });

    it('cannot skip steps', () => {
      const { service } = setup();
      expect(service.canTransition(S.NEW, S.APPROVED)).toBe(false);
      expect(service.canTransition(S.NEW, S.COMPLETED)).toBe(false);
      expect(service.canTransition(S.APPROVED, S.IN_PROGRESS)).toBe(false);
    });
  });

  describe('transition', () => {
    it('updates conditionally, writes history and audits in the same transaction', async () => {
      const { service, tx, audit } = setup(S.NEW);
      const result = await service.transition(tx as never, {
        requestId: 'r1',
        to: S.UNDER_REVIEW,
        actorId: 'dispatcher-1',
        reason: 'Starting review',
      });

      expect(result).toEqual({ from: S.NEW, to: S.UNDER_REVIEW });
      expect(tx.maintenanceRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'r1', status: S.NEW },
        data: { status: S.UNDER_REVIEW },
      });
      expect(tx.requestStatusHistory.create).toHaveBeenCalledWith({
        data: { request_id: 'r1', from_status: S.NEW, to_status: S.UNDER_REVIEW, changed_by: 'dispatcher-1', reason: 'Starting review' },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.REQUEST_STATUS_CHANGED, entityId: 'r1', oldValue: { status: S.NEW } }),
        tx,
      );
    });

    it('sets extra columns and uses a custom audit action', async () => {
      const { service, tx, audit } = setup(S.UNDER_REVIEW);
      await service.transition(tx as never, {
        requestId: 'r1',
        to: S.REJECTED,
        actorId: 'd1',
        reason: 'Out of scope',
        data: { rejection_reason: 'Out of scope' },
        auditAction: AuditAction.REQUEST_STATUS_CHANGED,
      });
      expect(tx.maintenanceRequest.updateMany.mock.calls[0][0].data).toEqual({
        rejection_reason: 'Out of scope',
        status: S.REJECTED,
      });
      expect(audit.log).toHaveBeenCalled();
    });

    it('refuses an illegal move with 409 INVALID_TRANSITION and writes nothing', async () => {
      const { service, tx, audit } = setup(S.NEW);
      await expect(
        service.transition(tx as never, { requestId: 'r1', to: S.APPROVED, actorId: 'd1' }),
      ).rejects.toMatchObject({ code: 'INVALID_TRANSITION', details: { from: S.NEW, to: S.APPROVED } });
      expect(tx.maintenanceRequest.updateMany).not.toHaveBeenCalled();
      expect(tx.requestStatusHistory.create).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('refuses to move a terminal case', async () => {
      const { service, tx } = setup(S.CANCELLED);
      await expect(
        service.transition(tx as never, { requestId: 'r1', to: S.UNDER_REVIEW, actorId: 'd1' }),
      ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    });

    it('returns CASE_CHANGED when someone else changed the status in between', async () => {
      const { service, tx, audit } = setup(S.NEW, 0);
      await expect(
        service.transition(tx as never, { requestId: 'r1', to: S.UNDER_REVIEW, actorId: 'd1' }),
      ).rejects.toMatchObject({ code: 'CASE_CHANGED' });
      expect(tx.requestStatusHistory.create).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('404s for an unknown case', async () => {
      const { service, tx } = setup(null);
      await expect(
        service.transition(tx as never, { requestId: 'nope', to: S.UNDER_REVIEW, actorId: 'd1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('recordCreated', () => {
    it('writes the first history row and the REQUEST_CREATED audit row', async () => {
      const { service, tx, audit } = setup();
      await service.recordCreated(tx as never, 'r1', 'customer-1', { priority: 'NORMAL' });
      expect(tx.requestStatusHistory.create).toHaveBeenCalledWith({
        data: { request_id: 'r1', from_status: null, to_status: S.NEW, changed_by: 'customer-1', reason: 'Submitted' },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.REQUEST_CREATED, actorId: 'customer-1', entityId: 'r1' }),
        tx,
      );
    });
  });
});
