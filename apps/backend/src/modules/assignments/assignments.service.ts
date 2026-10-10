import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AssignmentStatus,
  AuditAction,
  NotificationPriority,
  NotificationType,
  Prisma,
  ProfileStatus,
  RequestPriority,
  RequestStatus,
  Role,
} from '@prisma/client';
import { AppException } from '../../common/app.exception';
import { AuthenticatedUser } from '../../common/authenticated-user';
import { Db } from '../../common/db';
import { paginated, skipTake } from '../../common/pagination';
import { AuditService } from '../../infra/audit/audit.service';
import { NotificationsService } from '../../infra/notifications/notifications.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CaseLifecycleService } from '../cases/case-lifecycle.service';
import { CreateAssignmentDto, CreateExternalAssignmentDto, ListAssignmentsQuery } from './dto/assignments.dto';
import { RankingResult, TechnicianInput, rankTechnicians } from './ranking/ranking.calculator';

/** An assignment can be scheduled slightly in the past (clock drift), not further. */
const SCHEDULE_GRACE_MS = 5 * 60 * 1000;
/** NOTE(plan-alignment): every open assignment counts toward the 3-job limit, including PENDING ones. */
const ACTIVE_JOB: AssignmentStatus[] = [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED, AssignmentStatus.IN_PROGRESS];

const REQUEST_FOR_RANKING = {
  id: true,
  title: true,
  status: true,
  priority: true,
  customer_id: true,
  equipment: { select: { equipment_type: { select: { name: true, category: true } } } },
} satisfies Prisma.MaintenanceRequestSelect;

type RankingRequestRow = Prisma.MaintenanceRequestGetPayload<{ select: typeof REQUEST_FOR_RANKING }>;

const LIST_INCLUDE = {
  request: {
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      is_safety_escalated: true,
      address: { select: { street: true, city: true, district: true, floor: true, building: true, notes: true } },
      equipment: { select: { name: true, equipment_type: { select: { name: true, category: true } } } },
      customer: { select: { first_name: true } },
    },
  },
  technician: { select: { id: true, user: { select: { first_name: true, last_name: true } } } },
} satisfies Prisma.AssignmentInclude;

/** Dispatch: preview the ranking, assign an eligible technician (or an external one in an emergency), list assignments. */
@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lifecycle: CaseLifecycleService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------- ranking

  /** The ranking the dispatcher sees. Read-only; nothing is stored until an assignment is made. */
  async getRanking(requestId: string) {
    const request = await this.loadRequest(this.prisma, requestId);
    this.assertApproved(request);
    const ranking = await this.rank(this.prisma, request);
    return {
      request: { id: request.id, title: request.title, priority: request.priority, category: ranking.category },
      ...ranking,
    };
  }

  // ---------------------------------------------------------------- assigning

  async assign(dispatcher: AuthenticatedUser, requestId: string, dto: CreateAssignmentDto) {
    this.assertSchedule(dto.scheduled_at);

    const created = await this.prisma.runInTransaction(async (tx) => {
      const request = await this.loadRequest(tx, requestId);
      this.assertApproved(request);
      const ranking = await this.rank(tx, request);

      const chosen = ranking.ranking.find((r) => r.technicianProfileId === dto.technician_profile_id);
      if (!chosen) {
        const blocked = ranking.excluded.find((e) => e.technicianProfileId === dto.technician_profile_id);
        if (blocked) {
          throw new AppException('NOT_ELIGIBLE', 'That technician is not eligible for this case', 409, { reasons: blocked.reasons });
        }
        throw new AppException('UNKNOWN_TECHNICIAN', 'No approved technician with that id', 400);
      }

      // The ranking as the dispatcher saw it, kept with the assignment so the decision can be explained later.
      const snapshot = {
        version: 1,
        computed_at: new Date().toISOString(),
        priority: ranking.priority,
        category: ranking.category,
        rate_type: ranking.rateType,
        weights: ranking.weights,
        ranking: ranking.ranking,
        chosen: { technicianProfileId: chosen.technicianProfileId, rank: chosen.rank, score: chosen.score },
        overridden: chosen.rank > 1,
        ...(dto.note ? { dispatcher_note: dto.note } : {}),
      };

      // Claim the case first (APPROVED -> ASSIGNED, conditional), so two dispatchers cannot both assign it.
      await this.lifecycle.transition(tx, {
        requestId,
        to: RequestStatus.ASSIGNED,
        actorId: dispatcher.id,
        reason: 'Technician assigned',
      });
      const assignment = await tx.assignment.create({
        data: {
          request_id: requestId,
          technician_profile_id: chosen.technicianProfileId,
          assigned_by: dispatcher.id,
          status: AssignmentStatus.PENDING,
          scheduled_at: dto.scheduled_at,
          ranking_snapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
      });
      await this.audit.log(
        {
          actorId: dispatcher.id,
          action: AuditAction.ASSIGNMENT_CREATED,
          entityType: 'assignment',
          entityId: assignment.id,
          newValue: {
            request_id: requestId,
            technician_profile_id: chosen.technicianProfileId,
            rank: chosen.rank,
            score: chosen.score,
            overridden: chosen.rank > 1,
          },
        },
        tx,
      );
      return { assignment, request, technicianUserId: chosen.userId, rank: chosen.rank, overridden: chosen.rank > 1 };
    });

    await this.notifications.notify(created.technicianUserId, NotificationType.ASSIGNMENT_CREATED, {
      title: `New assignment: ${created.request.title}`,
      body: `${created.request.equipment.equipment_type.name} (${created.request.priority})`,
      requestId,
      priority: created.request.priority === RequestPriority.EMERGENCY ? NotificationPriority.URGENT : NotificationPriority.HIGH,
      data: { assignmentId: created.assignment.id, scheduledAt: created.assignment.scheduled_at?.toISOString() ?? null },
    });
    await this.notifyCustomerAssigned(created.request);
    return this.getOne(created.assignment.id);
  }

  /** EMERGENCY only, and only when no internal technician is free. The dispatcher arranged it by phone. */
  async assignExternal(dispatcher: AuthenticatedUser, requestId: string, dto: CreateExternalAssignmentDto) {
    this.assertSchedule(dto.scheduled_at);

    const created = await this.prisma.runInTransaction(async (tx) => {
      const request = await this.loadRequest(tx, requestId);
      this.assertApproved(request);
      if (request.priority !== RequestPriority.EMERGENCY) {
        throw new AppException('EXTERNAL_ONLY_FOR_EMERGENCY', 'An external technician can be used only for an emergency', 409);
      }
      const ranking = await this.rank(tx, request);
      // NOTE(plan-alignment): "available" now means eligible. Technicians at the 3-job limit, unavailable,
      // payment-blocked, without the skill, or who rejected this case are already left out of the ranking.
      if (ranking.ranking.length > 0) {
        throw new AppException('INTERNAL_AVAILABLE', 'An internal technician is available; assign one of them', 409, {
          available: ranking.ranking.length,
        });
      }

      await this.lifecycle.transition(tx, {
        requestId,
        to: RequestStatus.ASSIGNED,
        actorId: dispatcher.id,
        reason: 'External technician recorded',
      });
      const now = new Date();
      const assignment = await tx.assignment.create({
        data: {
          request_id: requestId,
          technician_profile_id: null,
          is_external: true,
          external_name: dto.external_name,
          external_phone: dto.external_phone,
          assigned_by: dispatcher.id,
          // The external technician has no account to accept with; the dispatcher agreed it by phone.
          status: AssignmentStatus.ACCEPTED,
          accepted_at: now,
          scheduled_at: dto.scheduled_at,
          ranking_snapshot: {
            version: 1,
            computed_at: now.toISOString(),
            external: true,
            internal_candidates: ranking.ranking.length,
            ...(dto.note ? { dispatcher_note: dto.note } : {}),
          },
        },
      });
      await this.audit.log(
        {
          actorId: dispatcher.id,
          action: AuditAction.ASSIGNMENT_CREATED,
          entityType: 'assignment',
          entityId: assignment.id,
          newValue: { request_id: requestId, external: true, external_name: dto.external_name },
        },
        tx,
      );
      return { assignment, request };
    });

    await this.notifyCustomerAssigned(created.request);
    return this.getOne(created.assignment.id);
  }

  // ---------------------------------------------------------------- reading

  /** Technicians see only their own assignments; dispatchers and managers see all. */
  async list(user: AuthenticatedUser, query: ListAssignmentsQuery) {
    const staff = user.roles.includes(Role.DISPATCHER) || user.roles.includes(Role.MANAGER);
    const where: Prisma.AssignmentWhereInput = {
      ...(staff ? {} : { technician: { user_id: user.id } }),
      status: query.status,
      request_id: query.request_id,
    };
    const [rows, total] = await Promise.all([
      this.prisma.assignment.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: [{ created_at: 'desc' }],
        ...skipTake(query),
      }),
      this.prisma.assignment.count({ where }),
    ]);
    return paginated(rows, query.page, query.pageSize, total);
  }

  getOne(id: string) {
    return this.prisma.assignment.findUniqueOrThrow({ where: { id }, include: LIST_INCLUDE });
  }

  // ---------------------------------------------------------------- helpers

  private async loadRequest(db: Db, requestId: string): Promise<RankingRequestRow> {
    const request = await db.maintenanceRequest.findUnique({ where: { id: requestId }, select: REQUEST_FOR_RANKING });
    if (!request) throw new NotFoundException('Case not found');
    return request;
  }

  private assertApproved(request: RankingRequestRow): void {
    if (request.status !== RequestStatus.APPROVED) {
      throw new AppException('NOT_APPROVED', 'Only an approved case can be assigned', 409, { status: request.status });
    }
  }

  private assertSchedule(scheduledAt?: Date): void {
    if (scheduledAt && scheduledAt.getTime() < Date.now() - SCHEDULE_GRACE_MS) {
      throw new AppException('SCHEDULE_IN_PAST', 'scheduled_at must not be in the past', 400);
    }
  }

  /** Loads the approved technicians with what the ranking needs and ranks them for this request. */
  private async rank(db: Db, request: RankingRequestRow): Promise<RankingResult> {
    const profiles = await db.technicianProfile.findMany({
      where: { profile_status: ProfileStatus.APPROVED },
      select: {
        id: true,
        user_id: true,
        years_of_experience: true,
        rating: true,
        total_reviews: true,
        is_available: true,
        is_payment_blocked: true,
        normal_rate: true,
        emergency_rate: true,
        user: { select: { first_name: true, last_name: true, is_active: true } },
        skills: { select: { proficiency_level: true, skill: { select: { category: true } } } },
        assignments: { where: { status: { in: ACTIVE_JOB } }, select: { id: true } },
      },
    });
    // Technicians who already rejected this case cannot be offered it again.
    const rejections = await db.assignment.findMany({
      where: { request_id: request.id, status: AssignmentStatus.REJECTED, technician_profile_id: { not: null } },
      select: { technician_profile_id: true },
    });
    const rejectedBy = new Set(rejections.map((r) => r.technician_profile_id));

    const technicians: TechnicianInput[] = profiles.map((p) => ({
      technicianProfileId: p.id,
      userId: p.user_id,
      name: `${p.user.first_name} ${p.user.last_name}`,
      accountActive: p.user.is_active,
      isAvailable: p.is_available,
      isPaymentBlocked: p.is_payment_blocked,
      yearsOfExperience: p.years_of_experience,
      rating: p.rating.toNumber(),
      totalReviews: p.total_reviews,
      normalRate: p.normal_rate.toNumber(),
      emergencyRate: p.emergency_rate.toNumber(),
      skills: p.skills.map((s) => ({ category: s.skill.category, proficiency: s.proficiency_level })),
      activeAssignments: p.assignments.length,
      rejectedThisCase: rejectedBy.has(p.id),
    }));

    return rankTechnicians(
      { priority: request.priority, category: request.equipment.equipment_type.category },
      technicians,
    );
  }

  private async notifyCustomerAssigned(request: RankingRequestRow): Promise<void> {
    await this.notifications.notify(request.customer_id, NotificationType.REQUEST_STATUS_CHANGED, {
      title: 'A technician has been assigned',
      body: request.title,
      requestId: request.id,
      data: { status: RequestStatus.ASSIGNED },
    });
  }
}
