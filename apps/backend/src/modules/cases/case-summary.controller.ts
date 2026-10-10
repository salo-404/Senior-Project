import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/authenticated-user';
import { CurrentUser, Roles } from '../../infra/auth/decorators';
import { CaseSummaryService } from './case-summary.service';
import { ConfirmSummaryDto } from './dto/summary.dto';

/** The customer's summary card. Under /requests because the customer thinks in requests; the logic is the case's. */
@Roles(Role.CUSTOMER)
@Controller('requests')
export class CaseSummaryController {
  constructor(private readonly summary: CaseSummaryService) {}

  @Get(':id/summary')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.summary.getSummary(user, id);
  }

  @HttpCode(200)
  @Post(':id/summary/confirm')
  confirm(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmSummaryDto) {
    return this.summary.confirm(user, id, dto);
  }
}
