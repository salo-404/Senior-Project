import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/authenticated-user';
import { CurrentUser, Roles } from '../../infra/auth/decorators';
import { CatalogService } from './catalog.service';
import {
  AddTeamMemberDto,
  CreateSkillDto,
  CreateTeamDto,
  CreateTierRequestDto,
  DecideTierRequestDto,
  ListTierRequestsQuery,
  SetScheduleDto,
  SetSkillsDto,
  UpdateRatesDto,
} from './dto/management.dto';
import { TechnicianProfileService } from './technician-profile.service';
import { TierRequestsService } from './tier-requests.service';

/** TIER_UPDATE requests. Initial applications keep their own routes in TechniciansController. */
@Controller()
export class TierRequestsController {
  constructor(private readonly tierRequests: TierRequestsService) {}

  @Roles(Role.TECHNICIAN)
  @Post('technicians/me/tier-requests')
  request(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateTierRequestDto) {
    return this.tierRequests.request(actor, dto);
  }

  @Roles(Role.MANAGER)
  @Get('manager/tier-requests')
  list(@Query() query: ListTierRequestsQuery) {
    return this.tierRequests.list(query);
  }

  @Roles(Role.MANAGER)
  @HttpCode(200)
  @Post('tier-requests/:id/decide')
  decide(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideTierRequestDto,
  ) {
    return this.tierRequests.decide(id, actor, dto);
  }
}

/** Rates, weekly schedule and skills of a technician profile. */
@Controller('technicians')
export class TechnicianProfileController {
  constructor(private readonly profiles: TechnicianProfileService) {}

  @Roles(Role.MANAGER)
  @Patch(':id/rates')
  updateRates(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRatesDto,
  ) {
    return this.profiles.updateRates(actor, id, dto);
  }

  /** A technician sets their own; a manager can set anyone's. null clears the schedule. */
  @Roles(Role.TECHNICIAN, Role.MANAGER)
  @Put(':id/schedule')
  setSchedule(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetScheduleDto,
  ) {
    return this.profiles.setSchedule(actor, id, dto.schedule);
  }

  /** Manager edits skills directly. A technician proposes skills through a tier request instead. */
  @Roles(Role.MANAGER)
  @Put(':id/skills')
  setSkills(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetSkillsDto,
  ) {
    return this.profiles.setSkills(actor, id, dto);
  }
}

/** Skill catalogue and teams (manager). GET /skills lives in TechniciansController. */
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Roles(Role.MANAGER)
  @Post('skills')
  createSkill(@Body() dto: CreateSkillDto) {
    return this.catalog.createSkill(dto);
  }

  @Roles(Role.MANAGER)
  @Post('teams')
  createTeam(@Body() dto: CreateTeamDto) {
    return this.catalog.createTeam(dto);
  }

  @Roles(Role.MANAGER)
  @Post('teams/:id/members')
  addMember(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddTeamMemberDto) {
    return this.catalog.addTeamMember(id, dto);
  }
}
