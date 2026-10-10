import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

/*
 * Scheduled jobs from plan section 4.4. They run inside the app (no Redis needed) and are empty stubs
 * until their owning module is built. AiHealthCheckJob is implemented in infra/health.
 * Each stub is meant to move into its owning module when that module is created.
 */

/** TODO(ai module): PENDING over 2 min -> re-queue; IN_PROGRESS over 5 min -> hand to the dispatcher. */
@Injectable()
export class StuckAiSweepJob {
  @Interval(2 * 60 * 1000)
  run(): void {
    // TODO: implemented with the ai module.
  }
}

/** TODO(ai module): customer silent for 30 min -> hand to the dispatcher with the answers so far. */
@Injectable()
export class InterviewInactivityJob {
  @Interval(5 * 60 * 1000)
  run(): void {
    // TODO: implemented with the ai module.
  }
}

// TierSuggestionJob is implemented in modules/technicians/tier-suggestion.job.ts.
