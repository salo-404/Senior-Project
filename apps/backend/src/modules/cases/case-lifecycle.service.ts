import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, RequestStatus } from '@prisma/client';
import { AppException } from '../../common/app.exception';
import { Db } from '../../common/db';
import { AuditService } from '../../infra/audit/audit.service';

const S = RequestStatus;

/**
 * The only allowed moves (plan/00_system_overview.md, "Case Lifecycle").
 * COMPLETED, CANCELLED and REJECTED are terminal. Who may make a move is checked by the caller.
 */
export const ALLOWED_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  [S.NEW]: [S.UNDER_REVIEW, S.CANCELLED],
  [S.UNDER_REVIEW]: [S.REQUIRES_FOLLOW_UP, S.APPROVED, S.REJECTED, S.CANCELLED],
  [S.REQUIRES_FOLLOW_UP]: [S.UNDER_REVIEW, S.CANCELLED],
  [S.APPROVED]: [S.ASSIGNED, S.CANCELLED],
  [S.ASSIGNED]: [S.IN_PROGRESS, S.APPROVED, S.CANCELLED],
  [S.IN_PROGRESS]: [S.COMPLETED],
  [S.COMPLETED]: [],
  [S.CANCELLED]: [],
  [S.REJECTED]: [],
};

export interface TransitionInput {
  requestId: string;
  to: RequestStatus;
  actorId: string;
  reason?: string;
  /** Extra columns to set on the request in the same update (for example rejection_reason). */
  data?: Prisma.MaintenanceRequestUncheckedUpdateManyInput;
  /** Audit action; defaults to REQUEST_STATUS_CHANGED. */
  auditAction?: AuditAction;
}

/**
 * Every status change in the system goes through here, inside the caller's transaction: it validates the move,
 * updates the request with a conditional write (two parallel changes cannot both win), and records the
 * status history and the audit row together with the change.
 */
@Injectable()
export class CaseLifecycleService {
  constructor(private readonly audit: AuditService) {}

  canTransition(from: RequestStatus, to: RequestStatus): boolean {
    return ALLOWED_TRANSITIONS[from].includes(to);
  }

  /** Writes the first history row (null -> NEW) and the REQUEST_CREATED audit row for a new request. */
  async recordCreated(tx: Db, requestId: string, actorId: string, details?: Prisma.InputJsonValue): Promise<void> {
    await tx.requestStatusHistory.create({
      data: { request_id: requestId, from_status: null, to_status: RequestStatus.NEW, changed_by: actorId, reason: 'Submitted' },
    });
    await this.audit.log(
      { actorId, action: AuditAction.REQUEST_CREATED, entityType: 'maintenance_request', entityId: requestId, newValue: details },
      tx,
    );
  }

  /**
   * Marks the request as a safety escalation (set once, never cleared). Returns false when it was already
   * escalated, so callers only notify dispatchers the first time.
   */
  async escalate(tx: Db, requestId: string, actorId: string, reason: string): Promise<boolean> {
    const result = await tx.maintenanceRequest.updateMany({
      where: { id: requestId, is_safety_escalated: false },
      data: { is_safety_escalated: true, escalated_at: new Date(), escalation_reason: reason },
    });
    if (result.count !== 1) return false;
    await this.audit.log(
      { actorId, action: AuditAction.SAFETY_ESCALATED, entityType: 'maintenance_request', entityId: requestId, newValue: { reason } },
      tx,
    );
    return true;
  }

  async transition(tx: Db, input: TransitionInput): Promise<{ from: RequestStatus; to: RequestStatus }> {
    const current = await tx.maintenanceRequest.findUnique({ where: { id: input.requestId }, select: { status: true } });
    if (!current) throw new NotFoundException('Case not found');

    const from = current.status;
    if (!this.canTransition(from, input.to)) {
      throw new AppException('INVALID_TRANSITION', `A case in ${from} cannot move to ${input.to}`, 409, {
        from,
        to: input.to,
      });
    }

    // Conditional update: only succeeds if the status is still what we just read.
    const updated = await tx.maintenanceRequest.updateMany({
      where: { id: input.requestId, status: from },
      data: { ...input.data, status: input.to },
    });
    if (updated.count !== 1) {
      throw new AppException('CASE_CHANGED', 'The case was changed by someone else. Reload and try again.', 409);
    }

    await tx.requestStatusHistory.create({
      data: { request_id: input.requestId, from_status: from, to_status: input.to, changed_by: input.actorId, reason: input.reason },
    });
    await this.audit.log(
      {
        actorId: input.actorId,
        action: input.auditAction ?? AuditAction.REQUEST_STATUS_CHANGED,
        entityType: 'maintenance_request',
        entityId: input.requestId,
        oldValue: { status: from },
        newValue: { status: input.to, ...(input.reason ? { reason: input.reason } : {}) },
      },
      tx,
    );
    return { from, to: input.to };
  }
}
