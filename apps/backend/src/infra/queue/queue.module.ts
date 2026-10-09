import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { InterviewInactivityJob, StuckAiSweepJob, TierSuggestionJob } from './jobs/scheduled-jobs.stubs';
import { QueueService } from './queue.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [QueueService, StuckAiSweepJob, InterviewInactivityJob, TierSuggestionJob],
  exports: [QueueService],
})
export class QueueModule {}
