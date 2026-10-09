import { QueueService } from './queue.service';

function makeService(): QueueService {
  const config = { get: () => 'redis://127.0.0.1:1' } as never;
  return new QueueService(config);
}

describe('QueueService with Redis down', () => {
  let service: QueueService;

  beforeAll(() => {
    service = makeService();
  });

  afterAll(async () => {
    await service.onModuleDestroy();
  });

  it('enqueueCaseDraft returns false instead of throwing', async () => {
    await expect(service.enqueueCaseDraft('r1')).resolves.toBe(false);
  });

  it('enqueueJobBrief returns false instead of throwing', async () => {
    await expect(service.enqueueJobBrief('a1')).resolves.toBe(false);
  });

  it('enqueueIngestion returns false instead of throwing', async () => {
    await expect(service.enqueueIngestion('d1')).resolves.toBe(false);
  });

  it('ping reports down', async () => {
    await expect(service.ping(500)).resolves.toBe(false);
  });
});
