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
