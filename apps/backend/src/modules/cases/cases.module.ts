import { Module } from '@nestjs/common';
import { AuditModule } from '../../infra/audit/audit.module';
import { NotificationsModule } from '../../infra/notifications/notifications.module';
import { CaseLifecycleService } from './case-lifecycle.service';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';

// CaseLifecycleService is exported: assignments and jobs (later stages) change status only through it.
@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [CasesController],
  providers: [CasesService, CaseLifecycleService],
  exports: [CaseLifecycleService],
})
export class CasesModule {}
