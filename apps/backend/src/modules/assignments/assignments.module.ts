import { Module } from '@nestjs/common';
import { AuditModule } from '../../infra/audit/audit.module';
import { NotificationsModule } from '../../infra/notifications/notifications.module';
import { CasesModule } from '../cases/cases.module';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';

@Module({
  imports: [AuditModule, NotificationsModule, CasesModule],
  controllers: [AssignmentsController],
  providers: [AssignmentsService],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
