import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TierRequestsService } from './tier-requests.service';

/**
 * Nightly at 02:00. Proposes a TIER_UPDATE request for technicians who qualify for the next tier; a manager decides.
 * It never changes a tier by itself. The work is in TierRequestsService.suggestTierUpdates so it can be tested directly.
 */
@Injectable()
export class TierSuggestionJob {
  private readonly logger = new Logger(TierSuggestionJob.name);

  constructor(private readonly tierRequests: TierRequestsService) {}

  @Cron('0 2 * * *')
  async run(): Promise<void> {
    try {
      await this.tierRequests.suggestTierUpdates();
    } catch (err) {
      // A failed night must not crash the app; the next run tries again.
      this.logger.error(`Tier suggestion run failed: ${(err as Error).message}`);
    }
  }
}
