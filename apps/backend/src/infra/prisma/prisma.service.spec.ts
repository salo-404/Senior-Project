import { PrismaService } from './prisma.service';

describe('PrismaService.runInTransaction', () => {
  it('passes the transaction client to the callback and returns its result', async () => {
    const service = new PrismaService();
    const tx = { marker: 'tx' };
    jest.spyOn(service, '$transaction').mockImplementation(((fn: (t: unknown) => unknown) => fn(tx)) as never);

    const result = await service.runInTransaction(async (client) => {
      expect(client).toBe(tx);
      return 42;
    });

    expect(result).toBe(42);
  });

  it('keeps Prisma\'s default timeout unless DB_TRANSACTION_TIMEOUT_MS is set', async () => {
    const service = new PrismaService();
    const spy = jest.spyOn(service, '$transaction').mockImplementation(((fn: (t: unknown) => unknown) => fn({})) as never);

    delete process.env.DB_TRANSACTION_TIMEOUT_MS;
    await service.runInTransaction(async () => 1);
    expect(spy).toHaveBeenLastCalledWith(expect.any(Function), undefined);

    process.env.DB_TRANSACTION_TIMEOUT_MS = '30000';
    try {
      await service.runInTransaction(async () => 1);
      expect(spy).toHaveBeenLastCalledWith(expect.any(Function), { timeout: 30000, maxWait: 30000 });
    } finally {
      delete process.env.DB_TRANSACTION_TIMEOUT_MS;
    }
  });

  it('propagates callback errors (so the transaction rolls back)', async () => {
    const service = new PrismaService();
    jest.spyOn(service, '$transaction').mockImplementation(((fn: (t: unknown) => unknown) => fn({})) as never);

    await expect(
      service.runInTransaction(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
