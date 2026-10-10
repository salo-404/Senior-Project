import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  CommissionTierName,
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
import { hashPassword } from '../../common/password';
import { uniqueViolationFields } from '../../common/prisma-errors';
import { AuditService } from '../../infra/audit/audit.service';
import { TechnicianProfileStatusPort } from '../../infra/auth/technician-profile-status.port';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CommissionTiersService } from '../billing/commission-tiers.service';
import {
  ApplicationDetailsDto,
  DecideApplicationDto,
  ListApplicationsQuery,
  RegisterTechnicianDto,
} from './dto/technicians.dto';

const APPLICATION_INCLUDE = {
  technician: {
    include: {
      user: { select: { id: true, email: true, phone: true, first_name: true, last_name: true, created_at: true } },
      skills: { include: { skill: true } },
    },
  },
  proposed_tier: true,
  final_tier: true,
} satisfies Prisma.TechnicianTierRequestInclude;

type ApplicationRow = Prisma.TechnicianTierRequestGetPayload<{ include: typeof APPLICATION_INCLUDE }>;

export interface RegisteredApplicant {
  user: { id: string; email: string; first_name: string; last_name: string; roles: Role[] };
  application_id: string;
  status: TierRequestStatus;
}

/**
 * Technician onboarding: signup with an application template, manager decision, re-apply after a rejection.
 * A technician stays PENDING_REVIEW (can sign in and see the status, not eligible for work) until a manager approves.
 */
@Injectable()
export class TechniciansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tiers: CommissionTiersService,
  ) {}

  // ---------------------------------------------------------------- signup and re-apply

  /** Public. Creates the account (TECHNICIAN role), a PENDING_REVIEW profile with its skills, and the INITIAL_APPLICATION. */
  async registerApplicant(dto: RegisterTechnicianDto): Promise<RegisteredApplicant> {
    const { skillIds, proposedTierId } = await this.validateDetails(dto.application);
    const passwordHash = await hashPassword(dto.password);

    try {
      return await this.prisma.runInTransaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: dto.email.toLowerCase(),
            phone: dto.phone,
            password_hash: passwordHash,
            first_name: dto.first_name,
            last_name: dto.last_name,
            is_active: true,
            roles: { create: { role: Role.TECHNICIAN } },
            technician_profile: {
              create: {
                bio: dto.application.bio,
                years_of_experience: dto.application.years_of_experience,
                profile_status: ProfileStatus.PENDING_REVIEW,
                normal_rate: dto.application.normal_rate,
                emergency_rate: dto.application.emergency_rate,
                skills: {
                  create: dto.application.skills.map((s) => ({
                    skill_id: s.skill_id,
                    proficiency_level: s.proficiency_level,
                  })),
                },
              },
            },
          },
          select: { id: true, email: true, first_name: true, last_name: true, technician_profile: { select: { id: true } } },
        });
        const profileId = user.technician_profile!.id;
        const application = await tx.technicianTierRequest.create({
          data: {
            technician_profile_id: profileId,
            request_type: TierRequestType.INITIAL_APPLICATION,
            proposed_tier_id: proposedTierId,
            supporting_notes: dto.application.supporting_notes,
          },
          select: { id: true },
        });
        await this.audit.log(
          {
            actorId: user.id,
            action: AuditAction.USER_CREATED,
            entityType: 'technician_profile',
            entityId: profileId,
            newValue: { role: Role.TECHNICIAN, self_registered: true, application_id: application.id, skills: skillIds },
          },
          tx,
        );
        return {
          user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, roles: [Role.TECHNICIAN] },
          application_id: application.id,
          status: TierRequestStatus.PENDING,
        };
      });
    } catch (err) {
      this.rethrowUnique(err);
      throw err;
    }
  }

  /** A rejected technician applies again with updated details. The earlier application stays on record. */
  async reapply(
    actor: AuthenticatedUser,
    dto: ApplicationDetailsDto,
  ): Promise<{ application_id: string; status: TierRequestStatus }> {
    const { skillIds, proposedTierId } = await this.validateDetails(dto);
    const profile = await this.prisma.technicianProfile.findUnique({ where: { user_id: actor.id }, select: { id: true } });
    if (!profile) throw new NotFoundException('Technician profile not found');

    const applicationId = await this.prisma.runInTransaction(async (tx) => {
      // Conditional update: only a REJECTED profile can go back to PENDING_REVIEW, and only once.
      const claimed = await tx.technicianProfile.updateMany({
        where: { id: profile.id, profile_status: ProfileStatus.REJECTED },
        data: {
          profile_status: ProfileStatus.PENDING_REVIEW,
          bio: dto.bio,
          years_of_experience: dto.years_of_experience,
          normal_rate: dto.normal_rate,
          emergency_rate: dto.emergency_rate,
        },
      });
      if (claimed.count !== 1) {
        throw new AppException('NOT_REJECTED', 'Only a rejected application can be resubmitted', 409);
      }
      await tx.technicianSkill.deleteMany({ where: { technician_profile_id: profile.id } });
      await tx.technicianSkill.createMany({
        data: dto.skills.map((s) => ({
          technician_profile_id: profile.id,
          skill_id: s.skill_id,
          proficiency_level: s.proficiency_level,
        })),
      });
      const application = await tx.technicianTierRequest.create({
        data: {
          technician_profile_id: profile.id,
          request_type: TierRequestType.INITIAL_APPLICATION,
          proposed_tier_id: proposedTierId,
          supporting_notes: dto.supporting_notes,
        },
        select: { id: true },
      });
      await this.audit.log(
        {
          actorId: actor.id,
          action: AuditAction.USER_UPDATED,
          entityType: 'technician_profile',
          entityId: profile.id,
          oldValue: { profile_status: ProfileStatus.REJECTED },
          newValue: { profile_status: ProfileStatus.PENDING_REVIEW, application_id: application.id, skills: skillIds },
        },
        tx,
      );
      return application.id;
    });
    return { application_id: applicationId, status: TierRequestStatus.PENDING };
  }

  /** The applicant's latest application and its outcome. */
  async mine(actor: AuthenticatedUser) {
    const row = await this.prisma.technicianTierRequest.findFirst({
      where: { request_type: TierRequestType.INITIAL_APPLICATION, technician: { user_id: actor.id } },
      include: APPLICATION_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
    if (!row) throw new NotFoundException('No application found');
    return this.present(row);
  }

  // ---------------------------------------------------------------- manager review

  async list(query: ListApplicationsQuery) {
    const where: Prisma.TechnicianTierRequestWhereInput = {
      request_type: TierRequestType.INITIAL_APPLICATION,
      status: query.status,
    };
    const [rows, total] = await Promise.all([
      this.prisma.technicianTierRequest.findMany({
        where,
        include: APPLICATION_INCLUDE,
        orderBy: { created_at: 'asc' },
        ...skipTake(query),
      }),
      this.prisma.technicianTierRequest.count({ where }),
    ]);
    return paginated(
      rows.map((r) => this.present(r)),
      query.page,
      query.pageSize,
      total,
    );
  }

  async get(id: string) {
    const row = await this.prisma.technicianTierRequest.findUnique({ where: { id }, include: APPLICATION_INCLUDE });
    if (!row) throw new NotFoundException('Application not found');
    return this.present(row);
  }

  /** Approving sets profile_status = APPROVED and grants a commission tier. Rejecting needs a reason. */
  async decide(id: string, actor: AuthenticatedUser, dto: DecideApplicationDto) {
    const existing = await this.prisma.technicianTierRequest.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Application not found');
    if (existing.request_type !== TierRequestType.INITIAL_APPLICATION) {
      throw new AppException('NOT_AN_APPLICATION', 'Only initial applications can be decided here', 400);
    }

    const approve = dto.decision === 'APPROVED';
    const tier = approve ? await this.resolveTier(dto.final_tier, existing.proposed_tier_id) : null;

    await this.prisma.runInTransaction(async (tx) => {
      // Conditional update: two managers cannot decide the same application.
      const claimed = await tx.technicianTierRequest.updateMany({
        where: { id, status: TierRequestStatus.PENDING },
        data: {
          status: approve ? TierRequestStatus.APPROVED : TierRequestStatus.REJECTED,
          decision_outcome: approve ? TierDecisionOutcome.TIER_CHANGED : null,
          final_tier_id: tier?.id ?? null,
          reviewed_by: actor.id,
          review_notes: dto.review_notes,
        },
      });
      if (claimed.count !== 1) throw new AppException('ALREADY_DECIDED', 'This application was already decided', 409);

      const profile = await tx.technicianProfile.update({
        where: { id: existing.technician_profile_id },
        data: {
          profile_status: approve ? ProfileStatus.APPROVED : ProfileStatus.REJECTED,
          current_tier_id: tier?.id ?? null,
          ...(approve && dto.normal_rate !== undefined ? { normal_rate: dto.normal_rate } : {}),
          ...(approve && dto.emergency_rate !== undefined ? { emergency_rate: dto.emergency_rate } : {}),
        },
      });
      if (profile.emergency_rate.lt(profile.normal_rate)) {
        throw new AppException('INVALID_RATES', 'emergency_rate must be at least normal_rate', 400);
      }
      await this.audit.log(
        {
          actorId: actor.id,
          action: approve ? AuditAction.TECHNICIAN_APPROVED : AuditAction.TECHNICIAN_REJECTED,
          entityType: 'technician_profile',
          entityId: profile.id,
          oldValue: { profile_status: ProfileStatus.PENDING_REVIEW },
          newValue: {
            profile_status: profile.profile_status,
            tier: tier?.name ?? null,
            normal_rate: profile.normal_rate.toString(),
            emergency_rate: profile.emergency_rate.toString(),
            application_id: id,
          },
        },
        tx,
      );
    });

    return this.get(id);
  }

  // ---------------------------------------------------------------- availability

  /**
   * The is_available switch. Only an APPROVED technician has one to flip. A technician can change their own;
   * a dispatcher can change anyone's. Another technician's profile is a 404 so its existence is not revealed.
   */
  async setAvailability(actor: AuthenticatedUser, profileId: string, isAvailable: boolean) {
    const isDispatcher = actor.roles.includes(Role.DISPATCHER);
    const profile = await this.prisma.technicianProfile.findFirst({
      where: { id: profileId, ...(isDispatcher ? {} : { user_id: actor.id }) },
      select: { id: true, profile_status: true, is_available: true },
    });
    if (!profile) throw new NotFoundException('Technician not found');
    if (profile.profile_status !== ProfileStatus.APPROVED) {
      throw new AppException('NOT_APPROVED', 'Availability can be set once the application is approved', 409);
    }
    if (profile.is_available === isAvailable) return { id: profile.id, is_available: isAvailable };

    await this.prisma.runInTransaction(async (tx) => {
      await tx.technicianProfile.update({ where: { id: profile.id }, data: { is_available: isAvailable } });
      await this.audit.log(
        {
          actorId: actor.id,
          action: AuditAction.USER_UPDATED,
          entityType: 'technician_profile',
          entityId: profile.id,
          oldValue: { is_available: profile.is_available },
          newValue: { is_available: isAvailable },
        },
        tx,
      );
    });
    return { id: profile.id, is_available: isAvailable };
  }

  // ---------------------------------------------------------------- skills and status port

  listSkills() {
    return this.prisma.skill.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  }

  /** Used by auth to show a technician's status in the session. */
  async getProfileStatus(userId: string): Promise<ProfileStatus | null> {
    const profile = await this.prisma.technicianProfile.findUnique({
      where: { user_id: userId },
      select: { profile_status: true },
    });
    return profile?.profile_status ?? null;
  }

  // ---------------------------------------------------------------- helpers

  private async validateDetails(details: ApplicationDetailsDto) {
    if (details.emergency_rate < details.normal_rate) {
      throw new AppException('INVALID_RATES', 'emergency_rate must be at least normal_rate', 400);
    }
    const skillIds = details.skills.map((s) => s.skill_id);
    if (new Set(skillIds).size !== skillIds.length) {
      throw new AppException('DUPLICATE_SKILLS', 'Each skill can be listed once', 400);
    }
    const found = await this.prisma.skill.count({ where: { id: { in: skillIds } } });
    if (found !== skillIds.length) throw new AppException('UNKNOWN_SKILL', 'One or more skills do not exist', 400);

    const proposed = details.proposed_tier ? await this.tiers.findByName(details.proposed_tier) : null;
    return { skillIds, proposedTierId: proposed?.id ?? null };
  }

  private async resolveTier(requested: CommissionTierName | undefined, proposedId: string | null) {
    const tier = requested
      ? await this.tiers.findByName(requested)
      : proposedId
        ? await this.tiers.findById(proposedId)
        : await this.tiers.findByName(CommissionTierName.BRONZE);
    if (!tier) throw new AppException('TIER_NOT_CONFIGURED', 'The commission tier is not configured', 400);
    return tier;
  }

  private present(row: ApplicationRow) {
    const { technician, ...rest } = row;
    const skills = technician.skills.map((s) => ({
      skill_id: s.skill_id,
      name: s.skill.name,
      category: s.skill.category,
      proficiency_level: s.proficiency_level,
    }));
    return {
      ...rest,
      applicant: technician.user,
      job_categories: [...new Set(skills.map((s) => s.category))],
      skills,
      years_of_experience: technician.years_of_experience,
      bio: technician.bio,
      requested_normal_rate: technician.normal_rate,
      requested_emergency_rate: technician.emergency_rate,
      profile_status: technician.profile_status,
    };
  }

  private rethrowUnique(err: unknown): void {
    const fields = uniqueViolationFields(err);
    if (!fields) return;
    if (fields.includes('phone')) throw new AppException('PHONE_TAKEN', 'That phone number is already in use', 409);
    throw new AppException('EMAIL_TAKEN', 'That email is already registered', 409);
  }
}

/** Lets auth read a technician's profile status without touching technician_profiles itself. */
@Injectable()
export class TechnicianProfileStatusProvider extends TechnicianProfileStatusPort {
  constructor(private readonly technicians: TechniciansService) {
    super();
  }

  getStatus(userId: string): Promise<ProfileStatus | null> {
    return this.technicians.getProfileStatus(userId);
  }
}
