import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  NotificationType,
  Prisma,
  ProfileStatus,
  Role,
  TierDecisionOutcome,
  TierRequestStatus,
  TierRequestType,
} from '@prisma/client';
import { AppException } from '../../common/app.exception';
import { AuthenticatedUser } from '../../common/authenticated-user';
import { paginated, skipTake } from '../../common/pagination';
import { AuditService } from '../../infra/audit/audit.service';
import { NotificationsService } from '../../infra/notifications/notifications.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CommissionTiersService } from '../billing/commission-tiers.service';
import { CreateTierRequestDto, DecideTierRequestDto, ListTierRequestsQuery } from './dto/management.dto';
import { CompletedJobsPort } from './ports';
import { decodePayload, encodePayload } from './tier-request-payload';

const TIER_REQUEST_INCLUDE = {
  technician: {
    select: {
      id: true,
      years_of_experience: true,
      rating: true,
      total_reviews: true,
      current_tier_id: true,
      user: { select: { id: true, email: true, first_name: true, last_name: true } },
    },
  },
  proposed_tier: { select: { id: true, name: true } },
  final_tier: { select: { id: true, name: true } },
} satisfies Prisma.TechnicianTierRequestInclude;

type TierRequestRow = Prisma.TechnicianTierRequestGetPayload<{ include: typeof TIER_REQUEST_INCLUDE }>;

/**
 * TIER_UPDATE requests: a technician asks a manager to review their tier and/or add skills, the manager decides, and a
 * nightly job proposes requests for technicians who qualify for the next tier. Initial applications are handled by
 * TechniciansService. Tier data comes from billing's CommissionTiersService, never from commission_tiers directly.
 */
@Injectable()
export class TierRequestsService {
  private readonly logger = new Logger(TierRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly tiers: CommissionTiersService,
    private readonly completedJobs: CompletedJobsPort,
  ) {}

  // ---------------------------------------------------------------- technician

  /** requestTierUpdate: one open request at a time, for an approved technician. */
  async request(actor: AuthenticatedUser, dto: CreateTierRequestDto) {
    const profile = await this.prisma.technicianProfile.findUnique({
      where: { user_id: actor.id },
      select: { id: true, profile_status: true, user: { select: { first_name: true, last_name: true } } },
    });
    if (!profile) throw new NotFoundException('Technician profile not found');
    if (profile.profile_status !== ProfileStatus.APPROVED) {
      throw new AppException('NOT_APPROVED', 'A tier update can be requested once your application is approved', 409);
    }

    const skillIds = dto.skillIds ?? [];
    if (skillIds.length > 0) {
      const known = await this.prisma.skill.count({ where: { id: { in: skillIds } } });
      if (known !== skillIds.length) throw new AppException('UNKNOWN_SKILL', 'One or more skills do not exist', 400);
    }

    const created = await this.prisma.runInTransaction(async (tx) => {
      const open = await tx.technicianTierRequest.count({
        where: { technician_profile_id: profile.id, request_type: TierRequestType.TIER_UPDATE, status: TierRequestStatus.PENDING },
      });
      if (open > 0) throw new AppException('REQUEST_PENDING', 'You already have a tier request waiting for a decision', 409);

      const row = await tx.technicianTierRequest.create({
        data: {
          technician_profile_id: profile.id,
          request_type: TierRequestType.TIER_UPDATE,
          supporting_notes: encodePayload({ notes: dto.notes, skill_ids: skillIds }),
        },
        select: { id: true },
      });
      await this.audit.log(
        {
          actorId: actor.id,
          action: AuditAction.USER_UPDATED,
          entityType: 'technician_tier_request',
          entityId: row.id,
          newValue: { request_type: TierRequestType.TIER_UPDATE, skill_ids: skillIds },
        },
        tx,
      );
      return row;
    });

    await this.notifications.notifyRole(Role.MANAGER, NotificationType.SYSTEM, {
      title: 'Tier update request',
      body: `${profile.user.first_name} ${profile.user.last_name} asked for a tier review.`,
      data: { tierRequestId: created.id },
    });
    return { id: created.id, status: TierRequestStatus.PENDING };
  }

  // ---------------------------------------------------------------- manager

  async list(query: ListTierRequestsQuery) {
    const where: Prisma.TechnicianTierRequestWhereInput = {
      request_type: TierRequestType.TIER_UPDATE,
      status: query.status,
    };
    const [rows, total] = await Promise.all([
      this.prisma.technicianTierRequest.findMany({
        where,
        include: TIER_REQUEST_INCLUDE,
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        ...skipTake(query),
      }),
      this.prisma.technicianTierRequest.count({ where }),
    ]);

    // Resolve the requested skill ids to names in one query.
    const wanted = [...new Set(rows.flatMap((r) => decodePayload(r.supporting_notes).skill_ids))];
    const skills = wanted.length
      ? await this.prisma.skill.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true, category: true } })
      : [];
    const byId = new Map(skills.map((s) => [s.id, s]));
    return paginated(
      rows.map((r) => this.present(r, byId)),
      query.page,
      query.pageSize,
      total,
    );
  }

  /**
   * decideTierRequest. TIER_CHANGED sets the technician's tier. SKILLS_NOTED_ONLY adds the requested skills (level 1,
   * the manager can raise it with PUT /technicians/:id/skills) and leaves the tier and commission alone. NO_CHANGE
   * closes the request. A request is APPROVED unless nothing changes, in which case it is REJECTED.
   */
  async decide(id: string, actor: AuthenticatedUser, dto: DecideTierRequestDto) {
    const existing = await this.prisma.technicianTierRequest.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tier request not found');
    if (existing.request_type !== TierRequestType.TIER_UPDATE) {
      throw new AppException('NOT_A_TIER_UPDATE', 'Initial applications are decided on the applications endpoint', 400);
    }

    const payload = decodePayload(existing.supporting_notes);
    let tierId: string | null = null;
    let tierName: string | null = null;

    if (dto.outcome === TierDecisionOutcome.TIER_CHANGED) {
      tierId = dto.finalTierId ?? existing.proposed_tier_id;
      if (!tierId) throw new AppException('TIER_REQUIRED', 'Choose the tier to grant (finalTierId)', 400);
      const tier = await this.tiers.findById(tierId);
      if (!tier) throw new AppException('TIER_NOT_FOUND', 'That commission tier does not exist', 400);
      tierName = tier.name;
    }
    if (dto.outcome === TierDecisionOutcome.SKILLS_NOTED_ONLY) {
      if (payload.skill_ids.length === 0) {
        throw new AppException('NO_SKILLS_REQUESTED', 'This request does not ask for any skills', 400);
      }
      const known = await this.prisma.skill.count({ where: { id: { in: payload.skill_ids } } });
      if (known !== payload.skill_ids.length) throw new AppException('UNKNOWN_SKILL', 'A requested skill no longer exists', 400);
    }

    const approved = dto.outcome !== TierDecisionOutcome.NO_CHANGE;
    const technicianUserId = await this.prisma.runInTransaction(async (tx) => {
      // Conditional update: two managers cannot decide the same request.
      const claimed = await tx.technicianTierRequest.updateMany({
        where: { id, status: TierRequestStatus.PENDING },
        data: {
          status: approved ? TierRequestStatus.APPROVED : TierRequestStatus.REJECTED,
          decision_outcome: dto.outcome,
          final_tier_id: tierId,
          reviewed_by: actor.id,
          review_notes: dto.notes,
        },
      });
      if (claimed.count !== 1) throw new AppException('ALREADY_DECIDED', 'This request was already decided', 409);

      const profile = await tx.technicianProfile.findUniqueOrThrow({
        where: { id: existing.technician_profile_id },
        select: { id: true, user_id: true, current_tier_id: true },
      });

      if (dto.outcome === TierDecisionOutcome.TIER_CHANGED) {
        await tx.technicianProfile.update({ where: { id: profile.id }, data: { current_tier_id: tierId } });
      }
      if (dto.outcome === TierDecisionOutcome.SKILLS_NOTED_ONLY) {
        await tx.technicianSkill.createMany({
          data: payload.skill_ids.map((skill_id) => ({ technician_profile_id: profile.id, skill_id, proficiency_level: 1 })),
          skipDuplicates: true,
        });
      }

      await this.audit.log(
        {
          actorId: actor.id,
          action: dto.outcome === TierDecisionOutcome.TIER_CHANGED ? AuditAction.TIER_CHANGED : AuditAction.USER_UPDATED,
          entityType: 'technician_profile',
          entityId: profile.id,
          oldValue: { current_tier_id: profile.current_tier_id },
          newValue: {
            outcome: dto.outcome,
            tier_request_id: id,
            ...(tierId ? { current_tier_id: tierId, tier: tierName } : {}),
            ...(dto.outcome === TierDecisionOutcome.SKILLS_NOTED_ONLY ? { skills_added: payload.skill_ids } : {}),
          },
        },
        tx,
      );
      return profile.user_id;
    });

    await this.notifications.notify(
      technicianUserId,
      dto.outcome === TierDecisionOutcome.TIER_CHANGED ? NotificationType.TIER_CHANGED : NotificationType.SYSTEM,
      {
        title: this.decisionTitle(dto.outcome, tierName),
        body: dto.notes ?? 'Your tier request was reviewed.',
        data: { tierRequestId: id, outcome: dto.outcome },
      },
    );

    const row = await this.prisma.technicianTierRequest.findUniqueOrThrow({ where: { id }, include: TIER_REQUEST_INCLUDE });
    return this.present(row, new Map());
  }

  // ---------------------------------------------------------------- nightly suggestion

  /**
   * Proposes a TIER_UPDATE (never changes a tier) for every approved technician who meets ALL of the NEXT tier's
   * thresholds: rating, years of experience and completed jobs. A tier with any threshold left empty is skipped,
   * and a technician with a request already waiting is skipped. Returns how many requests were created.
   */
  async suggestTierUpdates(): Promise<{ proposed: number }> {
    const profiles = await this.prisma.technicianProfile.findMany({
      where: { profile_status: ProfileStatus.APPROVED, user: { is_active: true } },
      select: { id: true, years_of_experience: true, rating: true, current_tier_id: true },
    });
    if (profiles.length === 0) return { proposed: 0 };

    const tiers = await this.tiers.list();
    const completed = await this.completedJobs.countCompleted(profiles.map((p) => p.id));
    const waiting = new Set(
      (
        await this.prisma.technicianTierRequest.findMany({
          where: { request_type: TierRequestType.TIER_UPDATE, status: TierRequestStatus.PENDING },
          select: { technician_profile_id: true },
        })
      ).map((r) => r.technician_profile_id),
    );

    let proposed = 0;
    for (const profile of profiles) {
      if (waiting.has(profile.id)) continue;
      const current = tiers.find((t) => t.id === profile.current_tier_id) ?? null;
      const next = this.tiers.nextTierOf(current?.name ?? null, tiers);
      if (!next) continue;
      if (next.min_rating === null || next.min_experience_years === null || next.min_completed_jobs === null) continue;

      const jobs = completed.get(profile.id) ?? 0;
      const rating = profile.rating.toNumber();
      const meets =
        rating >= next.min_rating.toNumber() &&
        profile.years_of_experience >= next.min_experience_years &&
        jobs >= next.min_completed_jobs;
      if (!meets) continue;

      await this.prisma.runInTransaction(async (tx) => {
        const row = await tx.technicianTierRequest.create({
          data: {
            technician_profile_id: profile.id,
            request_type: TierRequestType.TIER_UPDATE,
            proposed_tier_id: next.id,
            supporting_notes: encodePayload({
              notes: `Automatic suggestion: rating ${rating.toFixed(2)}, ${profile.years_of_experience} years and ${jobs} completed jobs meet the ${next.name} thresholds.`,
              skill_ids: [],
              suggested: true,
            }),
          },
          select: { id: true },
        });
        await this.audit.log(
          {
            actorId: null,
            action: AuditAction.USER_UPDATED,
            entityType: 'technician_tier_request',
            entityId: row.id,
            newValue: { suggested: true, proposed_tier: next.name, technician_profile_id: profile.id },
          },
          tx,
        );
      });
      proposed++;
    }

    if (proposed > 0) {
      await this.notifications.notifyRole(Role.MANAGER, NotificationType.SYSTEM, {
        title: 'Tier suggestions',
        body: `${proposed} technician${proposed === 1 ? '' : 's'} qualify for the next tier. Review them under tier requests.`,
      });
      this.logger.log(`Proposed ${proposed} tier update(s)`);
    }
    return { proposed };
  }

  // ---------------------------------------------------------------- helpers

  private decisionTitle(outcome: TierDecisionOutcome, tierName: string | null): string {
    if (outcome === TierDecisionOutcome.TIER_CHANGED) return `Your tier is now ${tierName}`;
    if (outcome === TierDecisionOutcome.SKILLS_NOTED_ONLY) return 'Your new skills were added';
    return 'Your tier request was reviewed';
  }

  private present(row: TierRequestRow, skillsById: Map<string, { id: string; name: string; category: string }>) {
    const payload = decodePayload(row.supporting_notes);
    const { supporting_notes: _raw, ...rest } = row;
    return {
      ...rest,
      notes: payload.notes,
      suggested: payload.suggested ?? false,
      requested_skills: payload.skill_ids.map((id) => skillsById.get(id) ?? { id }),
    };
  }
}
