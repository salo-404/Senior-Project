import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/authenticated-user';
import { CurrentUser, Roles } from '../../infra/auth/decorators';
import { CasesService } from './cases.service';
import { CancelCaseDto, FollowUpResponseDto, ListCasesQuery, ReviewCaseDto, UpdateCaseDto } from './dto/cases.dto';

/** "Case" = a request plus its case record. The id in every route is the request id. */
@Controller('cases')
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  /** Customers see their own cases; dispatchers and managers see the queue. */
  @Roles(Role.CUSTOMER, Role.DISPATCHER, Role.MANAGER)
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListCasesQuery) {
    return this.cases.list(user, query);
  }

  @Roles(Role.CUSTOMER, Role.DISPATCHER, Role.MANAGER)
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.cases.get(user, id);
  }

  @Roles(Role.DISPATCHER)
  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCaseDto) {
    return this.cases.update(user, id, dto);
  }

  @Roles(Role.DISPATCHER)
  @HttpCode(200)
  @Post(':id/review')
  review(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewCaseDto) {
    return this.cases.review(user, id, dto);
  }

  @Roles(Role.CUSTOMER)
  @HttpCode(200)
  @Post(':id/follow-up-response')
  respondToFollowUp(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FollowUpResponseDto,
  ) {
    return this.cases.respondToFollowUp(user, id, dto);
  }

  @Roles(Role.CUSTOMER)
  @HttpCode(200)
  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelCaseDto) {
    return this.cases.cancel(user, id, dto);
  }
}
