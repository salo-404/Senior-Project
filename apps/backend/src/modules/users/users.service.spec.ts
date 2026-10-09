import { NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, RequestPriority, Role } from '@prisma/client';
import { sha256 } from '../../common/tokens';
import { ACTIVATION_TTL_MS, UsersService } from './users.service';

const actor = { id: 'manager-1', roles: [Role.MANAGER] };

function uniqueError(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

function userRow(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    email: 'u1@test.dev',
    phone: null,
    first_name: 'A',
    last_name: 'B',
    is_active: true,
    created_at: new Date(),
    roles: [{ role: Role.DISPATCHER }],
    ...over,
  };
}

function setup() {
  const tx = {
    user: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    userRole: { deleteMany: jest.fn(), create: jest.fn() },
    customerProfile: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const prisma = {
    ...tx,
    runInTransaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockReturnValue('http://web.test') };
  const service = new UsersService(prisma as never, audit as never, config as never);
  return { service, prisma, tx, audit };
}

describe('UsersService.registerCustomer', () => {
  it('creates a user with the CUSTOMER role only and audits it', async () => {
    const { service, tx, audit } = setup();
    tx.user.create.mockResolvedValue(userRow({ roles: [{ role: Role.CUSTOMER }] }));

    const user = await service.registerCustomer({
      email: 'Cust@Test.dev',
      password: 'password123',
      first_name: 'C',
      last_name: 'D',
    });

    const data = tx.user.create.mock.calls[0][0].data;
    expect(data.email).toBe('cust@test.dev');
    expect(data.roles).toEqual({ create: { role: Role.CUSTOMER } });
    expect(data.customer_profile).toEqual({ create: {} });
    expect(data.password_hash).toMatch(/^\$argon2id\$/);
    expect(user.roles).toEqual([Role.CUSTOMER]);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.USER_CREATED }), tx);
  });

  it('reports a duplicate email as EMAIL_TAKEN (409)', async () => {
    const { service, tx } = setup();
    tx.user.create.mockRejectedValue(uniqueError(['email']));
    await expect(
      service.registerCustomer({ email: 'a@b.c', password: 'password123', first_name: 'A', last_name: 'B' }),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN', status: 409 });
  });
});

describe('UsersService.createStaff', () => {
  it('creates an inactive staff user with a hashed 48 h activation token and returns the token once', async () => {
    const { service, tx, audit } = setup();
    tx.user.create.mockResolvedValue(userRow({ is_active: false }));
    const before = Date.now();

    const result = await service.createStaff(
      { email: 'D@Test.dev', first_name: 'D', last_name: 'X', role: Role.DISPATCHER },
      actor,
    );

    const data = tx.user.create.mock.calls[0][0].data;
    expect(data.is_active).toBe(false);
    expect(data.roles).toEqual({ create: { role: Role.DISPATCHER } });
    expect(data.activation_token_hash).toBe(sha256(result.activationToken));
    expect(data.activation_token_hash).not.toContain(result.activationToken);
    expect(data.activation_expires_at.getTime()).toBeGreaterThanOrEqual(before + ACTIVATION_TTL_MS - 1000);
    expect(data.activation_expires_at.getTime()).toBeLessThanOrEqual(Date.now() + ACTIVATION_TTL_MS);
    expect(result.activationLink).toBe(`http://web.test/activate?token=${result.activationToken}`);
    expect(JSON.stringify(result.user)).not.toContain('password');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.USER_CREATED, actorId: actor.id }),
      tx,
    );
  });

  it('never stores the activation token in the audit row', async () => {
    const { service, tx, audit } = setup();
    tx.user.create.mockResolvedValue(userRow({ is_active: false }));
    const result = await service.createStaff(
      { email: 'd@test.dev', first_name: 'D', last_name: 'X', role: Role.MANAGER },
      actor,
    );
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain(result.activationToken);
  });
});

describe('UsersService.activateAccount', () => {
  const token = 'plain-token';
  const future = () => new Date(Date.now() + 60_000);

  it('sets the password, activates the account and clears the token', async () => {
    const { service, prisma, tx, audit } = setup();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', is_active: false, activation_expires_at: future() });
    tx.user.updateMany.mockResolvedValue({ count: 1 });

    await service.activateAccount(token, 'new-password-1');

    const call = tx.user.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: 'u1', activation_token_hash: sha256(token), is_active: false });
    expect(call.data).toMatchObject({ is_active: true, activation_token_hash: null, activation_expires_at: null });
    expect(call.data.password_hash).toMatch(/^\$argon2id\$/);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.ACCOUNT_ACTIVATED }), tx);
  });

  it.each([
    ['unknown token', null],
    ['expired token', { id: 'u1', is_active: false, activation_expires_at: new Date(Date.now() - 1000) }],
    ['already activated', { id: 'u1', is_active: true, activation_expires_at: null }],
  ])('rejects %s with INVALID_ACTIVATION_TOKEN', async (_name, row) => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue(row);
    await expect(service.activateAccount(token, 'new-password-1')).rejects.toMatchObject({
      code: 'INVALID_ACTIVATION_TOKEN',
      status: 400,
    });
  });

  it('loses the race when another request used the link first', async () => {
    const { service, prisma, tx } = setup();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', is_active: false, activation_expires_at: future() });
    tx.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.activateAccount(token, 'new-password-1')).rejects.toMatchObject({
      code: 'INVALID_ACTIVATION_TOKEN',
    });
  });
});

describe('UsersService.deactivateUser', () => {
  it('refuses to deactivate yourself', async () => {
    const { service } = setup();
    await expect(service.deactivateUser(actor.id, actor)).rejects.toMatchObject({ code: 'CANNOT_DEACTIVATE_SELF' });
  });

  it('returns 404 for an unknown user', async () => {
    const { service, tx } = setup();
    tx.user.findUnique.mockResolvedValue(null);
    await expect(service.deactivateUser('missing', actor)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to deactivate the last active manager', async () => {
    const { service, tx } = setup();
    tx.user.findUnique.mockResolvedValue(userRow({ roles: [{ role: Role.MANAGER }] }));
    tx.user.count.mockResolvedValue(0);
    await expect(service.deactivateUser('u1', actor)).rejects.toMatchObject({ code: 'LAST_MANAGER' });
  });

  it('deactivates and audits', async () => {
    const { service, tx, audit } = setup();
    tx.user.findUnique.mockResolvedValue(userRow());
    const result = await service.deactivateUser('u1', actor);
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { is_active: false } });
    expect(result.is_active).toBe(false);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.USER_DEACTIVATED }), tx);
  });

  it('does nothing (and writes no audit row) when the user is already inactive', async () => {
    const { service, tx, audit } = setup();
    tx.user.findUnique.mockResolvedValue(userRow({ is_active: false }));
    await service.deactivateUser('u1', actor);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('UsersService.changeRole', () => {
  it('never lets a manager change their own role', async () => {
    const { service } = setup();
    await expect(service.changeRole(actor.id, Role.DISPATCHER, actor)).rejects.toMatchObject({
      code: 'CANNOT_CHANGE_OWN_ROLE',
      status: 403,
    });
  });

  it('only applies to staff accounts', async () => {
    const { service, tx } = setup();
    tx.user.findUnique.mockResolvedValue(userRow({ roles: [{ role: Role.CUSTOMER }] }));
    await expect(service.changeRole('u1', Role.MANAGER, actor)).rejects.toMatchObject({ code: 'NOT_STAFF_ACCOUNT' });
  });

  it('refuses to demote the last active manager', async () => {
    const { service, tx } = setup();
    tx.user.findUnique.mockResolvedValue(userRow({ roles: [{ role: Role.MANAGER }] }));
    tx.user.count.mockResolvedValue(0);
    await expect(service.changeRole('u1', Role.DISPATCHER, actor)).rejects.toMatchObject({ code: 'LAST_MANAGER' });
  });

  it('replaces the staff role and audits old and new roles', async () => {
    const { service, tx, audit } = setup();
    tx.user.findUnique.mockResolvedValue(userRow());
    const result = await service.changeRole('u1', Role.MANAGER, actor);
    expect(tx.userRole.deleteMany).toHaveBeenCalledWith({
      where: { user_id: 'u1', role: { in: [Role.DISPATCHER, Role.MANAGER] } },
    });
    expect(tx.userRole.create).toHaveBeenCalledWith({ data: { user_id: 'u1', role: Role.MANAGER } });
    expect(result.roles).toEqual([Role.MANAGER]);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.USER_ROLE_CHANGED,
        oldValue: { roles: [Role.DISPATCHER] },
        newValue: { roles: [Role.MANAGER] },
      }),
      tx,
    );
  });
});

describe('UsersService.assertCanCreateRequest', () => {
  const profile = (over = {}) => ({
    has_unpaid_balance: true,
    unpaid_amount: new Prisma.Decimal('12.50'),
    ...over,
  });

  it('passes when the customer has no profile or no balance', async () => {
    const { service, prisma } = setup();
    prisma.customerProfile.findUnique.mockResolvedValue(null);
    await expect(service.assertCanCreateRequest('c1', RequestPriority.NORMAL)).resolves.toEqual({
      flagUnpaidBalance: false,
      unpaidAmountCents: 0,
    });
    prisma.customerProfile.findUnique.mockResolvedValue(profile({ has_unpaid_balance: false }));
    await expect(service.assertCanCreateRequest('c1', RequestPriority.URGENT)).resolves.toMatchObject({
      flagUnpaidBalance: false,
    });
  });

  it.each([RequestPriority.NORMAL, RequestPriority.URGENT])('blocks %s requests while a balance is unpaid', async (p) => {
    const { service, prisma } = setup();
    prisma.customerProfile.findUnique.mockResolvedValue(profile());
    await expect(service.assertCanCreateRequest('c1', p)).rejects.toMatchObject({ code: 'UNPAID_BALANCE', status: 403 });
  });

  it('lets an EMERGENCY request through and returns the flag with the amount in cents', async () => {
    const { service, prisma } = setup();
    prisma.customerProfile.findUnique.mockResolvedValue(profile());
    await expect(service.assertCanCreateRequest('c1', RequestPriority.EMERGENCY)).resolves.toEqual({
      flagUnpaidBalance: true,
      unpaidAmountCents: 1250,
    });
  });

  it('reads through the caller transaction when given one', async () => {
    const { service, prisma, tx } = setup();
    const own = { customerProfile: { findUnique: jest.fn().mockResolvedValue(null) } };
    await service.assertCanCreateRequest('c1', RequestPriority.NORMAL, own as never);
    expect(own.customerProfile.findUnique).toHaveBeenCalled();
    expect(prisma.customerProfile.findUnique).not.toHaveBeenCalled();
    expect(tx.customerProfile.findUnique).not.toHaveBeenCalled();
  });
});

describe('UsersService.addUnpaid / clearUnpaid', () => {
  it.each([0, -5, 1.5, Number.NaN])('rejects the amount %p', async (cents) => {
    const { service } = setup();
    await expect(service.addUnpaid('c1', cents)).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    await expect(service.clearUnpaid('c1', cents)).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  it('runs inside the caller transaction and reports a missing profile as 404', async () => {
    const { service, prisma } = setup();
    const own = { $queryRaw: jest.fn().mockResolvedValue([]) };
    await expect(service.addUnpaid('c1', 500, own as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(own.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('succeeds when the profile exists', async () => {
    const { service } = setup();
    const own = { $queryRaw: jest.fn().mockResolvedValue([{ id: 'p1' }]) };
    await expect(service.addUnpaid('c1', 500, own as never)).resolves.toBeUndefined();
    await expect(service.clearUnpaid('c1', 500, own as never)).resolves.toBeUndefined();
  });
});
