import { AuditAction } from '@prisma/client';
import { runWithContext } from '../../common/request-context';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  const globalCreate = jest.fn();
  const txCreate = jest.fn();
  const prisma = { auditLog: { create: globalCreate, findMany: jest.fn() } } as never;
  const tx = { auditLog: { create: txCreate, findMany: jest.fn() } } as never;
  const service = new AuditService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('writes through the caller transaction when one is given', async () => {
    await service.log(
      { actorId: 'u1', action: AuditAction.USER_UPDATED, entityType: 'user', entityId: 'u2' },
      tx,
    );
    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(globalCreate).not.toHaveBeenCalled();
  });

  it('falls back to the shared client without a transaction', async () => {
    await service.log({ actorId: null, action: AuditAction.LOGIN_FAILED, entityType: 'user', entityId: 'unknown' });
    expect(globalCreate).toHaveBeenCalledTimes(1);
  });

  it('takes the correlation id and ip from the request context', async () => {
    const correlationId = '11111111-1111-4111-8111-111111111111';
    await runWithContext({ correlationId, ip: '10.0.0.1' }, () =>
      service.log({ actorId: 'u1', action: AuditAction.LOGOUT, entityType: 'user', entityId: 'u1' }, tx),
    );
    expect(txCreate.mock.calls[0][0].data).toMatchObject({ correlation_id: correlationId, ip_address: '10.0.0.1' });
  });

  it('only exposes read and create operations (append-only)', () => {
    const methods = Object.getOwnPropertyNames(AuditService.prototype).filter((m) => m !== 'constructor');
    expect(methods.sort()).toEqual(['findByEntity', 'log']);
  });
});
