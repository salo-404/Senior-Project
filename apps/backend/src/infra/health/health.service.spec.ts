import { AiHealthService } from './ai-health.service';
import { HealthService } from './health.service';

const config = (aiEnabled: boolean, url = 'http://127.0.0.1:1') =>
  ({ get: (key: string) => (key === 'AI_ENABLED' ? aiEnabled : url) }) as never;

describe('AiHealthService', () => {
  it('is unhealthy when AI_ENABLED=false, even if Ollama answers', async () => {
    const svc = new AiHealthService(config(false));
    jest.spyOn(svc, 'pingOllama').mockResolvedValue(true);
    await svc.refresh();
    expect(svc.isHealthy()).toBe(false);
  });

  it('becomes healthy when enabled and Ollama answers, and flips back when it stops', async () => {
    const svc = new AiHealthService(config(true));
    const ping = jest.spyOn(svc, 'pingOllama').mockResolvedValue(true);
    await svc.refresh();
    expect(svc.isHealthy()).toBe(true);
    ping.mockResolvedValue(false);
    await svc.refresh();
    expect(svc.isHealthy()).toBe(false);
  });

  it('starts unhealthy before the first check', () => {
    expect(new AiHealthService(config(true)).isHealthy()).toBe(false);
  });

  it('reports an unreachable Ollama as down without throwing', async () => {
    await expect(new AiHealthService(config(true)).pingOllama(500)).resolves.toBe(false);
  });
});

describe('HealthService', () => {
  it('reports each dependency independently and survives probes that throw', async () => {
    const svc = new HealthService(
      { $queryRaw: jest.fn().mockResolvedValue([1]) } as never,
      { ping: jest.fn().mockResolvedValue(false) } as never,
      { ping: jest.fn().mockRejectedValue(new Error('boom')) } as never,
      { pingOllama: jest.fn().mockResolvedValue(false) } as never,
    );
    await expect(svc.check()).resolves.toEqual({ db: 'up', redis: 'down', ollama: 'down', storage: 'down' });
  });
});
