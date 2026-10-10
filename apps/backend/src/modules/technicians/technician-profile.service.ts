import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, Role } from '@prisma/client';
import { AppException } from '../../common/app.exception';
import { AuthenticatedUser } from '../../common/authenticated-user';
import { Db } from '../../common/db';
import { AuditService } from '../../infra/audit/audit.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SetSkillsDto, UpdateRatesDto } from './dto/management.dto';
import { ReviewStatsPort } from './ports';
import { validateSchedule } from './schedule.validation';

/**
 * Manager-side and technician-side edits of a technician profile that are not part of onboarding:
 * rates, weekly schedule, skills, and the rating statistics.
 */
@Injectable()
export class TechnicianProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reviewStats: ReviewStatsPort,
  ) {}

  // ---------------------------------------------------------------- rates (manager)

  /** Changes the two hourly rates. The ranking reads them from the profile, so it uses the new rates at once. */
  async updateRates(actor: AuthenticatedUser, profileId: string, dto: UpdateRatesDto) {
    if (dto.emergency_rate < dto.normal_rate) {
      throw new AppException('INVALID_RATES', 'emergency_rate must be at least normal_rate', 400);
    }
    return this.prisma.runInTransaction(async (tx) => {
      const before = await tx.technicianProfile.findUnique({
        where: { id: profileId },
        select: { id: true, normal_rate: true, emergency_rate: true },
      });
      if (!before) throw new NotFoundException('Technician not found');

      const after = await tx.technicianProfile.update({
        where: { id: profileId },
        data: { normal_rate: dto.normal_rate, emergency_rate: dto.emergency_rate },
        select: { id: true, normal_rate: true, emergency_rate: true },
      });
      await this.audit.log(
        {
          actorId: actor.id,
          action: AuditAction.USER_UPDATED,
          entityType: 'technician_profile',
          entityId: profileId,
          oldValue: { normal_rate: before.normal_rate.toString(), emergency_rate: before.emergency_rate.toString() },
          newValue: { normal_rate: after.normal_rate.toString(), emergency_rate: after.emergency_rate.toString() },
        },
        tx,
      );
      return after;
    });
  }

  // ---------------------------------------------------------------- weekly schedule

  /**
   * Stores technician_profiles.weekly_schedule (null clears it). A technician sets their own; a manager can set
   * anyone's. Another technician's profile is a 404. The ranking does not read the schedule (yet).
   */
  async setSchedule(actor: AuthenticatedUser, profileId: string, schedule: unknown) {
    const clean = validateSchedule(schedule);
    const isManager = actor.roles.includes(Role.MANAGER);

    return this.prisma.runInTransaction(async (tx) => {
      const before = await tx.technicianProfile.findFirst({
        where: { id: profileId, ...(isManager ? {} : { user_id: actor.id }) },
        select: { id: true, weekly_schedule: true },
      });
      if (!before) throw new NotFoundException('Technician not found');

      await tx.technicianProfile.update({
        where: { id: profileId },
        data: { weekly_schedule: clean === null ? Prisma.DbNull : (clean as Prisma.InputJsonValue) },
      });
      await this.audit.log(
        {
          actorId: actor.id,
          action: AuditAction.USER_UPDATED,
          entityType: 'technician_profile',
          entityId: profileId,
          oldValue: { weekly_schedule: (before.weekly_schedule as Prisma.InputJsonValue | null) ?? null },
          newValue: { weekly_schedule: (clean as Prisma.InputJsonValue | null) ?? null },
        },
        tx,
      );
      return { id: profileId, weekly_schedule: clean };
    });
  }

  // ---------------------------------------------------------------- skills (manager)

  /**
   * Replaces a technician's skills. Manager only: the schema has no "proposed" state for a skill, so a
   * technician proposes skills through a TIER_UPDATE request and the manager confirms them (or edits here).
   */
  async setSkills(actor: AuthenticatedUser, profileId: string, dto: SetSkillsDto) {
    const skillIds = dto.skills.map((s) => s.skill_id);
    if (new Set(skillIds).size !== skillIds.length) {
      throw new AppException('DUPLICATE_SKILLS', 'Each skill can be listed once', 400);
    }
    const known = await this.prisma.skill.count({ where: { id: { in: skillIds } } });
    if (known !== skillIds.length) throw new AppException('UNKNOWN_SKILL', 'One or more skills do not exist', 400);

    return this.prisma.runInTransaction(async (tx) => {
      const profile = await tx.technicianProfile.findUnique({ where: { id: profileId }, select: { id: true } });
      if (!profile) throw new NotFoundException('Technician not found');

      const before = await tx.technicianSkill.findMany({
        where: { technician_profile_id: profileId },
        select: { skill_id: true, proficiency_level: true },
      });
      await tx.technicianSkill.deleteMany({ where: { technician_profile_id: profileId } });
      await tx.technicianSkill.createMany({
        data: dto.skills.map((s) => ({
          technician_profile_id: profileId,
          skill_id: s.skill_id,
          proficiency_level: s.proficiency_level,
        })),
      });
      await this.audit.log(
        {
          actorId: actor.id,
          action: AuditAction.USER_UPDATED,
          entityType: 'technician_profile',
          entityId: profileId,
          oldValue: { skills: before },
          newValue: { skills: dto.skills.map((s) => ({ skill_id: s.skill_id, proficiency_level: s.proficiency_level })) },
        },
        tx,
      );
      return { id: profileId, skills: dto.skills };
    });
  }

  // ---------------------------------------------------------------- rating statistics

  /**
   * Recomputes rating and total_reviews from the visible reviews. Called by the reviews module (Stage 4) inside the
   * transaction that creates or hides a review. Returns false and changes nothing when reviews are not available.
   */
  async updateStats(profileId: string, tx?: Db): Promise<boolean> {
    const db = tx ?? this.prisma;
    const stats = await this.reviewStats.getVisibleStats(profileId, tx);
    if (!stats) return false;

    // technician_profiles.rating is Decimal(3,2): two decimals, never above 5.
    const rating = stats.count === 0 ? 0 : Math.min(5, Math.round(stats.average * 100) / 100);
    const result = await db.technicianProfile.updateMany({
      where: { id: profileId },
      data: { rating, total_reviews: stats.count },
    });
    if (result.count !== 1) throw new NotFoundException('Technician not found');
    return true;
  }
}
