import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { EnvVars } from '../../config/env.validation';

export const QUEUE_NAMES = {
  aiCaseDraft: 'ai-case-draft',
  aiJobBrief: 'ai-job-brief',
  knowledgeIngestion: 'knowledge-ingestion',
} as const;

/**
 * Producer side of the three queues. Postgres is the source of truth and Redis only a helper,
 * so an enqueue failure is logged and reported as `false`; it never throws into business code.
 * No processors exist yet (the AI module and the Python worker add them later).
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly connection: IORedis;
  private readonly queues: Record<string, Queue>;

  constructor(config: ConfigService<EnvVars, true>) {
    this.connection = new IORedis(config.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
      // Fail fast while Redis is down instead of buffering commands forever.
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });
    this.connection.on('error', (err) => this.warnOnce(`Redis connection error: ${err.message}`));
    this.connection.on('ready', () => this.logger.log('Redis connection ready'));

    this.queues = Object.fromEntries(
      Object.values(QUEUE_NAMES).map((name) => [name, new Queue(name, { connection: this.connection })]),
    );
    for (const queue of Object.values(this.queues)) {
      // The shared connection already reports the cause; queue errors only repeat it.
      queue.on('error', () => undefined);
    }
  }

  enqueueCaseDraft(requestId: string): Promise<boolean> {
    return this.enqueue(QUEUE_NAMES.aiCaseDraft, { requestId }, `case-draft-${requestId}`);
  }

  enqueueJobBrief(assignmentId: string): Promise<boolean> {
    return this.enqueue(QUEUE_NAMES.aiJobBrief, { assignmentId }, `job-brief-${assignmentId}`);
  }

  enqueueIngestion(documentId: string): Promise<boolean> {
    return this.enqueue(QUEUE_NAMES.knowledgeIngestion, { documentId }, `ingestion-${documentId}`);
  }

  /** Used by the health check. */
  async ping(timeoutMs = 1500): Promise<boolean> {
    try {
      const result = await Promise.race([
        this.connection.ping(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ]);
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  private async enqueue(queueName: string, data: Record<string, string>, jobId: string): Promise<boolean> {
    // BullMQ waits for the connection before adding, which would hang while Redis is down. Fail fast instead.
    if (this.connection.status !== 'ready') {
      this.logger.warn(`Redis is not ready; ${queueName} job ${jobId} was not queued`);
      return false;
    }
    try {
      await Promise.race([
        this.queues[queueName].add(queueName, data, {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('enqueue timed out')), 3000).unref()),
      ]);
      return true;
    } catch (err) {
      this.logger.warn(`Could not enqueue ${queueName} job ${jobId}: ${(err as Error).message}`);
      return false;
    }
  }

  private lastWarning = 0;
  /** Redis retries every few seconds while it is down; log at most once every 30 seconds. */
  private warnOnce(message: string): void {
    const now = Date.now();
    if (now - this.lastWarning > 30_000) {
      this.lastWarning = now;
      this.logger.warn(message);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled(Object.values(this.queues).map((q) => q.close()));
    this.connection.disconnect();
  }
}
