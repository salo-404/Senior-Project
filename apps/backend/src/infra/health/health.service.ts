import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { StorageService } from '../storage/storage.service';
import { AiHealthService } from './ai-health.service';

export type UpDown = 'up' | 'down';
export interface HealthReport {
  db: UpDown;
  redis: UpDown;
  ollama: UpDown;
  storage: UpDown;
}

const label = (ok: boolean): UpDown => (ok ? 'up' : 'down');

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly storage: StorageService,
    private readonly aiHealth: AiHealthService,
  ) {}

  /** Every probe is isolated: a failing dependency reports "down" and never crashes the endpoint. */
  async check(): Promise<HealthReport> {
    const [db, redis, ollama, storage] = await Promise.all([
      this.probe(async () => {
        await this.prisma.$queryRaw`SELECT 1`;
        return true;
      }),
      this.probe(() => this.queue.ping()),
      this.probe(() => this.aiHealth.pingOllama()),
      this.probe(() => this.storage.ping()),
    ]);
    return { db: label(db), redis: label(redis), ollama: label(ollama), storage: label(storage) };
  }

  private async probe(fn: () => Promise<boolean>): Promise<boolean> {
    try {
      return await Promise.race([
        fn(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
      ]);
    } catch {
      return false;
    }
  }
}
