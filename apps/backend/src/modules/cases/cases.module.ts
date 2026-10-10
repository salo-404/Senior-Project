import { Module } from '@nestjs/common';
import { AuditModule } from '../../infra/audit/audit.module';
import { NotificationsModule } from '../../infra/notifications/notifications.module';
import { SafetyModule } from '../../infra/safety/safety.module';
import { CaseLifecycleService } from './case-lifecycle.service';
import { CaseSummaryController } from './case-summary.controller';
import { CaseSummaryService } from './case-summary.service';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';

// CaseLifecycleService is exported: assignments and jobs (later stages) change status only through it.
@Module({
  imports: [AuditModule, NotificationsModule, SafetyModule],
  controllers: [CasesController, CaseSummaryController],
  providers: [CasesService, CaseLifecycleService, CaseSummaryService],
  exports: [CaseLifecycleService],
})
export class CasesModule {}
