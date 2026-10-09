import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/authenticated-user';
import { CurrentUser, Public, Roles } from '../../infra/auth/decorators';
import { DecideApplicationDto, ListApplicationsQuery, ReapplyDto, SetAvailabilityDto } from './dto/technicians.dto';
import { TechniciansService } from './technicians.service';

@Controller()
export class TechniciansController {
  constructor(private readonly technicians: TechniciansService) {}

  /** Skill catalogue for the application form. */
  @Public()
  @Get('skills')
  listSkills() {
    return this.technicians.listSkills();
  }

  @Roles(Role.TECHNICIAN)
  @Get('technician-applications/mine')
  mine(@CurrentUser() actor: AuthenticatedUser) {
    return this.technicians.mine(actor);
  }

  @Roles(Role.TECHNICIAN)
  @Post('technician-applications/reapply')
  reapply(@CurrentUser() actor: AuthenticatedUser, @Body() dto: ReapplyDto) {
    return this.technicians.reapply(actor, dto);
  }

  /** The availability switch. A technician flips their own; a dispatcher can flip anyone's. */
  @Roles(Role.TECHNICIAN, Role.DISPATCHER)
  @Patch('technicians/:id/availability')
  setAvailability(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetAvailabilityDto,
  ) {
    return this.technicians.setAvailability(actor, id, dto.is_available);
  }

  @Roles(Role.MANAGER)
  @Get('technician-tier-requests')
  list(@Query() query: ListApplicationsQuery) {
    return this.technicians.list(query);
  }

  @Roles(Role.MANAGER)
  @Get('technician-tier-requests/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.technicians.get(id);
  }

  @Roles(Role.MANAGER)
  @Patch('technician-tier-requests/:id')
  decide(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideApplicationDto,
  ) {
    return this.technicians.decide(id, actor, dto);
  }
}
