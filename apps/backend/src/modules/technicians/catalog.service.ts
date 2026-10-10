import { Injectable, NotFoundException } from '@nestjs/common';
import { ProfileStatus } from '@prisma/client';
import { AppException } from '../../common/app.exception';
import { uniqueViolationFields } from '../../common/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AddTeamMemberDto, CreateSkillDto, CreateTeamDto } from './dto/management.dto';

/**
 * The skill catalogue and teams. Manager-only writes. GET /skills (read) stays in TechniciansController.
 * There is no audit action for catalogue changes in the schema, so they are not audited.
 */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async createSkill(dto: CreateSkillDto) {
    try {
      return await this.prisma.skill.create({
        data: { name: dto.name.trim(), category: dto.category, description: dto.description },
      });
    } catch (err) {
      if (uniqueViolationFields(err)) throw new AppException('SKILL_EXISTS', 'A skill with that name already exists', 409);
      throw err;
    }
  }

  createTeam(dto: CreateTeamDto) {
    return this.prisma.team.create({
      data: { name: dto.name.trim(), category: dto.category, description: dto.description },
    });
  }

  /** Only an approved technician can join a team. team_members.user_id is the technician's user id. */
  async addTeamMember(teamId: string, dto: AddTeamMemberDto) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) throw new NotFoundException('Team not found');

    const profile = await this.prisma.technicianProfile.findUnique({
      where: { user_id: dto.user_id },
      select: { profile_status: true },
    });
    if (!profile) throw new NotFoundException('Technician not found');
    if (profile.profile_status !== ProfileStatus.APPROVED) {
      throw new AppException('NOT_APPROVED', 'Only an approved technician can join a team', 409);
    }

    try {
      return await this.prisma.teamMember.create({
        data: { team_id: teamId, user_id: dto.user_id, role_in_team: dto.role_in_team },
      });
    } catch (err) {
      if (uniqueViolationFields(err)) throw new AppException('ALREADY_MEMBER', 'That technician is already in this team', 409);
      throw err;
    }
  }
}
