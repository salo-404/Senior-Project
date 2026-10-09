import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { AiHealthCheckJob, AiHealthService } from './ai-health.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [QueueModule, StorageModule],
  controllers: [HealthController],
  providers: [HealthService, AiHealthService, AiHealthCheckJob],
  exports: [AiHealthService],
})
export class HealthModule {}
