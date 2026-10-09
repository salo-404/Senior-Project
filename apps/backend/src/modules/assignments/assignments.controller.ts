import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/authenticated-user';
import { CurrentUser, Roles } from '../../infra/auth/decorators';
import { AssignmentsService } from './assignments.service';
import { CreateAssignmentDto, CreateExternalAssignmentDto, ListAssignmentsQuery } from './dto/assignments.dto';

@Controller()
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  /** Eligible candidates with every factor, the weights and the score. Read-only. */
  @Roles(Role.DISPATCHER)
  @Get('cases/:id/technician-ranking')
  ranking(@Param('id', ParseUUIDPipe) id: string) {
    return this.assignments.getRanking(id);
  }

  @Roles(Role.DISPATCHER)
  @Post('cases/:id/assignments')
  assign(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateAssignmentDto) {
    return this.assignments.assign(user, id, dto);
  }

  @Roles(Role.DISPATCHER)
  @Post('cases/:id/assignments/external')
  assignExternal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateExternalAssignmentDto,
  ) {
    return this.assignments.assignExternal(user, id, dto);
  }

  /** Technicians see their own assignments; dispatchers and managers see all. */
  @Roles(Role.DISPATCHER, Role.TECHNICIAN, Role.MANAGER)
  @Get('assignments')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListAssignmentsQuery) {
    return this.assignments.list(user, query);
  }
}
