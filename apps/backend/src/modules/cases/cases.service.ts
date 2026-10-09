import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  NotificationPriority,
  NotificationType,
  Prisma,
  RequestStatus,
  Role,
  UrgencyLevel,
} from '@prisma/client';
import { AppException } from '../../common/app.exception';
import { AuthenticatedUser } from '../../common/authenticated-user';
import { Db } from '../../common/db';
import { paginated, skipTake } from '../../common/pagination';
import { AuditService } from '../../infra/audit/audit.service';
import { NotificationsService } from '../../infra/notifications/notifications.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CaseLifecycleService } from './case-lifecycle.service';
import { CancelCaseDto, FollowUpResponseDto, ListCasesQuery, ReviewCaseDto, UpdateCaseDto } from './dto/cases.dto';

const isStaff = (user: AuthenticatedUser) => user.roles.includes(Role.DISPATCHER) || user.roles.includes(Role.MANAGER);

interface FollowUpEntry {
  question: string;
  asked_by: string;
  asked_at: string;
  answer: string | null;
  answered_at: string | null;
}

/** The "case" view of a request (the request plus its case record): lists, details and the review workflow. */
@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lifecycle: CaseLifecycleService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------- reading

  async list(user: AuthenticatedUser, query: ListCasesQuery) {
    const staff = isStaff(user);
    const where: Prisma.MaintenanceRequestWhereInput = {
      ...(staff ? {} : { customer_id: user.id }),
      status: query.status,
      priority: query.priority,
      ...(staff && query.escalated !== undefined ? { is_safety_escalated: query.escalated } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.maintenanceRequest.findMany({
        where,
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          is_safety_escalated: true,
          customer_had_unpaid_balance: true,
          created_at: true,
          updated_at: true,
          equipment: { select: { name: true, equipment_type: { select: { name: true, category: true } } } },
          case: { select: { source: true, urgency_level: true } },
          ...(staff ? { customer: { select: { first_name: true, last_name: true } } } : {}),
        } as Prisma.MaintenanceRequestSelect,
        // Dispatcher queue: escalations first, then emergency > urgent > normal, oldest first.
        orderBy: staff
          ? [{ is_safety_escalated: 'desc' }, { priority: 'desc' }, { created_at: 'asc' }]
          : [{ created_at: 'desc' }],
        ...skipTake(query),
      }),
      this.prisma.maintenanceRequest.count({ where }),
    ]);
    return paginated(rows, query.page, query.pageSize, total);
  }

  async get(user: AuthenticatedUser, id: string) {
    const staff = isStaff(user);
    const request = await this.prisma.maintenanceRequest.findFirst({
      where: { id, ...(staff ? {} : { customer_id: user.id }) },
      include: {
        case: true,
        status_history: { orderBy: { created_at: 'asc' } },
        equipment: { include: { equipment_type: true } },
        address: true,
        // Metadata only; the file itself is opened through GET /attachments/:id/url.
        attachments: { select: { id: true, purpose: true, file_type: true, file_size: true, created_at: true } },
        ...(staff ? { customer: { select: { id: true, first_name: true, last_name: true, phone: true } } } : {}),
      },
    });
    if (!request) throw new NotFoundException('Case not found');
    return request;
  }

  // ---------------------------------------------------------------- dispatcher actions

  /** Dispatcher edits the case record while reviewing it. A HIGH or CRITICAL urgency escalates the request. */
  async update(user: AuthenticatedUser, id: string, dto: UpdateCaseDto) {
    let newlyEscalated = false;

    await this.prisma.runInTransaction(async (tx) => {
      const request = await this.findForUpdate(tx, id);
      if (request.status !== RequestStatus.UNDER_REVIEW) {
        throw new AppException('NOT_UNDER_REVIEW', 'A case can be edited only while it is under review', 409);
      }

      const caseData: Prisma.MaintenanceCaseUpdateInput = {
        summary: dto.summary,
        urgency_level: dto.urgency_level,
        symptoms: dto.symptoms,
        possible_causes: dto.possible_causes,
      };
      await tx.maintenanceCase.update({ where: { request_id: id }, data: caseData });
      if (dto.problem_type !== undefined) {
        await tx.maintenanceRequest.update({ where: { id }, data: { problem_type: dto.problem_type } });
      }

      if (dto.urgency_level === UrgencyLevel.HIGH || dto.urgency_level === UrgencyLevel.CRITICAL) {
        newlyEscalated = await this.lifecycle.escalate(tx, id, user.id, `Assessed urgency ${dto.urgency_level}`);
      }
    });

    if (newlyEscalated) {
      await this.notifications.notifyRole(Role.DISPATCHER, NotificationType.SAFETY_ESCALATED, {
        title: 'Safety escalation',
        body: `A case was assessed as ${dto.urgency_level} urgency.`,
        requestId: id,
        priority: NotificationPriority.URGENT,
      });
    }
    return this.get(user, id);
  }

  async review(user: AuthenticatedUser, id: string, dto: ReviewCaseDto) {
    const outcome = await this.prisma.runInTransaction(async (tx) => {
      await this.findForUpdate(tx, id);
      const reason = dto.reason?.trim();

      switch (dto.action) {
        case 'START':
          return this.lifecycle.transition(tx, { requestId: id, to: RequestStatus.UNDER_REVIEW, actorId: user.id, reason: 'Review started' });

        case 'REQUIRE_FOLLOW_UP': {
          const result = await this.lifecycle.transition(tx, {
            requestId: id,
            to: RequestStatus.REQUIRES_FOLLOW_UP,
            actorId: user.id,
            reason,
          });
          const current = await tx.maintenanceCase.findUniqueOrThrow({ where: { request_id: id } });
          const questions = (Array.isArray(current.follow_up_questions) ? current.follow_up_questions : []) as unknown as FollowUpEntry[];
          const entry: FollowUpEntry = {
            question: reason!,
            asked_by: user.id,
            asked_at: new Date().toISOString(),
            answer: null,
            answered_at: null,
          };
          await tx.maintenanceCase.update({
            where: { request_id: id },
            data: { follow_up_questions: [...questions, entry] as unknown as Prisma.InputJsonValue },
          });
          return result;
        }

        case 'APPROVE': {
          const result = await this.lifecycle.transition(tx, {
            requestId: id,
            to: RequestStatus.APPROVED,
            actorId: user.id,
            reason: reason ?? 'Approved by dispatcher',
          });
          await tx.maintenanceCase.update({ where: { request_id: id }, data: { verified_by: user.id, verified_at: new Date() } });
          await this.audit.log(
            { actorId: user.id, action: AuditAction.CASE_VERIFIED, entityType: 'maintenance_case', entityId: id },
            tx,
          );
          return result;
        }

        case 'REJECT':
          return this.lifecycle.transition(tx, {
            requestId: id,
            to: RequestStatus.REJECTED,
            actorId: user.id,
            reason,
            data: { rejection_reason: reason },
          });
      }
    });

    await this.notifyCustomer(id, outcome.to, dto.reason);
    return this.get(user, id);
  }

  // ---------------------------------------------------------------- customer actions

  async respondToFollowUp(user: AuthenticatedUser, id: string, dto: FollowUpResponseDto) {
    await this.prisma.runInTransaction(async (tx) => {
      await this.findOwnedForUpdate(tx, user, id);
      await this.lifecycle.transition(tx, {
        requestId: id,
        to: RequestStatus.UNDER_REVIEW,
        actorId: user.id,
        reason: 'Customer answered the follow-up',
      });
      const current = await tx.maintenanceCase.findUniqueOrThrow({ where: { request_id: id } });
      const questions = (Array.isArray(current.follow_up_questions) ? current.follow_up_questions : []) as unknown as FollowUpEntry[];
      const open = questions.map((q) => q.answer).lastIndexOf(null);
      if (open >= 0) {
        questions[open] = { ...questions[open], answer: dto.answer, answered_at: new Date().toISOString() };
        await tx.maintenanceCase.update({
          where: { request_id: id },
          data: { follow_up_questions: questions as unknown as Prisma.InputJsonValue },
        });
      }
    });

    await this.notifications.notifyRole(Role.DISPATCHER, NotificationType.REQUEST_STATUS_CHANGED, {
      title: 'Customer answered a follow-up',
      body: 'The case is back under review.',
      requestId: id,
    });
    return this.get(user, id);
  }

  /** Allowed from NEW, UNDER_REVIEW, REQUIRES_FOLLOW_UP, APPROVED and ASSIGNED; never once work has started. */
  async cancel(user: AuthenticatedUser, id: string, dto: CancelCaseDto) {
    await this.prisma.runInTransaction(async (tx) => {
      await this.findOwnedForUpdate(tx, user, id);
      // TODO(stage 3): when the case is ASSIGNED, also cancel its active assignment in this transaction.
      await this.lifecycle.transition(tx, {
        requestId: id,
        to: RequestStatus.CANCELLED,
        actorId: user.id,
        reason: dto.reason,
        data: { cancellation_reason: dto.reason, cancelled_by: user.id },
        auditAction: AuditAction.REQUEST_CANCELLED,
      });
    });

    await this.notifications.notifyRole(Role.DISPATCHER, NotificationType.REQUEST_STATUS_CHANGED, {
      title: 'A customer cancelled a case',
      body: dto.reason,
      requestId: id,
    });
    return this.get(user, id);
  }

  // ---------------------------------------------------------------- helpers

  /** Dispatchers (and managers) act on any case. Missing case: 404. */
  private async findForUpdate(tx: Db, id: string) {
    const request = await tx.maintenanceRequest.findUnique({ where: { id }, select: { id: true, status: true, customer_id: true } });
    if (!request) throw new NotFoundException('Case not found');
    return request;
  }

  /** A customer acts only on their own case; any other case is a 404 so its existence is not revealed. */
  private async findOwnedForUpdate(tx: Db, user: AuthenticatedUser, id: string) {
    const request = await tx.maintenanceRequest.findFirst({ where: { id, customer_id: user.id }, select: { id: true, status: true } });
    if (!request) throw new NotFoundException('Case not found');
    return request;
  }

  /** After commit: the customer is told about every dispatcher decision. */
  private async notifyCustomer(requestId: string, status: RequestStatus, reason?: string): Promise<void> {
    const request = await this.prisma.maintenanceRequest.findUnique({
      where: { id: requestId },
      select: { customer_id: true, title: true },
    });
    if (!request) return;
    await this.notifications.notify(request.customer_id, NotificationType.REQUEST_STATUS_CHANGED, {
      title: `Your request is now ${status.replace(/_/g, ' ').toLowerCase()}`,
      body: reason ? `${request.title}: ${reason}` : request.title,
      requestId,
      data: { status },
    });
  }
}

