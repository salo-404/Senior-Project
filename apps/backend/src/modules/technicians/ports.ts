import { Injectable } from '@nestjs/common';
import { Db } from '../../common/db';

/**
 * The technicians module never reads the reviews or assignments tables. It asks for what it needs through these
 * ports, which the owning modules provide.
 */

export interface ReviewStats {
  /** Number of VISIBLE reviews. */
  count: number;
  /** Average of the visible ratings, 0 when there are none. */
  average: number;
}

/**
 * Implemented by the reviews module (Stage 4). `null` means "reviews are not available", and updateStats then
 * leaves rating and total_reviews alone, so calling it early can never reset a technician's rating.
 */
export abstract class ReviewStatsPort {
  abstract getVisibleStats(technicianProfileId: string, tx?: Db): Promise<ReviewStats | null>;
}

/** Default until the reviews module exists. */
@Injectable()
export class NoReviewStats extends ReviewStatsPort {
  async getVisibleStats(): Promise<ReviewStats | null> {
    return null;
  }
}

/** Implemented by the assignments module: how many COMPLETED assignments each technician has. */
export abstract class CompletedJobsPort {
  abstract countCompleted(technicianProfileIds: string[]): Promise<Map<string, number>>;
}
