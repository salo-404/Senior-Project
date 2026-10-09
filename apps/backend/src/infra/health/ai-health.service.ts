import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import type { EnvVars } from '../../config/env.validation';

/**
 * In-memory flag for "is the AI usable right now". The ai module reads it to switch to Plan B at once.
 * AI_ENABLED=false forces it to unhealthy. Starts unhealthy until the first check succeeds.
 */
@Injectable()
export class AiHealthService implements OnModuleInit {
  private readonly logger = new Logger(AiHealthService.name);
  private healthy = false;
  private readonly enabled: boolean;
  private readonly ollamaUrl: string;

  constructor(config: ConfigService<EnvVars, true>) {
    this.enabled = config.get('AI_ENABLED', { infer: true });
    this.ollamaUrl = config.get('OLLAMA_URL', { infer: true });
  }

  onModuleInit(): void {
    // Do not block startup on a slow or missing Ollama.
    void this.refresh();
  }

  isHealthy(): boolean {
    return this.enabled && this.healthy;
  }

  /** Pings Ollama and updates the flag. Never throws. */
  async refresh(): Promise<boolean> {
    if (!this.enabled) {
      this.healthy = false;
      return false;
    }
    const up = await this.pingOllama();
    if (up !== this.healthy) {
      this.logger.log(`Ollama is now ${up ? 'up' : 'down'}`);
    }
    this.healthy = up;
    return up;
  }

  /** Reachability only; used by GET /health regardless of AI_ENABLED. */
  async pingOllama(timeoutMs = 2000): Promise<boolean> {
    try {
      const res = await fetch(`${this.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

/** Runs the check every 30 seconds. */
@Injectable()
export class AiHealthCheckJob {
  constructor(private readonly aiHealth: AiHealthService) {}

  @Interval(30_000)
  async run(): Promise<void> {
    await this.aiHealth.refresh();
  }
}
