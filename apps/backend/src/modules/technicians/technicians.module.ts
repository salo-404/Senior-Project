import { Module } from '@nestjs/common';
import { AuditModule } from '../../infra/audit/audit.module';
import { NotificationsModule } from '../../infra/notifications/notifications.module';
import { AssignmentsModule } from '../assignments/assignments.module';
import { AssignmentsService } from '../assignments/assignments.service';
import { BillingModule } from '../billing/billing.module';
import { CatalogService } from './catalog.service';
import { CatalogController, TechnicianProfileController, TierRequestsController } from './management.controllers';
import { CompletedJobsPort, NoReviewStats, ReviewStatsPort } from './ports';
import { TechnicianProfileService } from './technician-profile.service';
import { TechniciansController } from './technicians.controller';
import { TechnicianProfileStatusProvider, TechniciansService } from './technicians.service';
import { TierRequestsService } from './tier-requests.service';
import { TierSuggestionJob } from './tier-suggestion.job';

// Must not import AuthModule: AuthModule imports this module (status port and the signup route).
@Module({
  imports: [AuditModule, NotificationsModule, BillingModule, AssignmentsModule],
  controllers: [TechniciansController, TierRequestsController, TechnicianProfileController, CatalogController],
  providers: [
    TechniciansService,
    TechnicianProfileStatusProvider,
    TechnicianProfileService,
    TierRequestsService,
    CatalogService,
    TierSuggestionJob,
    // Replaced by the reviews module in Stage 4. Until then updateStats leaves rating and review count alone.
    { provide: ReviewStatsPort, useClass: NoReviewStats },
    // How many COMPLETED jobs a technician has: owned by assignments.
    { provide: CompletedJobsPort, useExisting: AssignmentsService },
  ],
  exports: [TechniciansService, TechnicianProfileStatusProvider, TechnicianProfileService, TierRequestsService, ReviewStatsPort],
})
export class TechniciansModule {}
