import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditAction, ProfileStatus, Role } from '@prisma/client';
import { hashPassword } from '../../common/password';
import { sha256 } from '../../common/tokens';
import { AuthService } from './auth.service';
import { TechnicianProfileStatusPort } from './technician-profile-status.port';

const ACCESS_SECRET = 'a'.repeat(40);
const REFRESH_SECRET = 'b'.repeat(40);
const PASSWORD = 'correct-horse-battery';

interface TokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  is_revoked: boolean;
}

async function setup(overrides: { active?: boolean; technicianStatus?: ProfileStatus | null } = {}) {
  const passwordHash = await hashPassword(PASSWORD);
  const user = {
    id: 'u1',
    password_hash: passwordHash,
    is_active: overrides.active ?? true,
    roles: [{ role: Role.CUSTOMER }],
  };

  const tokens: TokenRow[] = [];
  const refreshToken = {
    create: jest.fn(async ({ data }: { data: Omit<TokenRow, 'id' | 'is_revoked'> }) => {
      const row = { id: `t${tokens.length + 1}`, is_revoked: false, ...data };
      tokens.push(row);
      return row;
    }),
    findUnique: jest.fn(async ({ where }: { where: { token_hash: string } }) =>
      tokens.find((t) => t.token_hash === where.token_hash) ?? null,
    ),
    updateMany: jest.fn(async ({ where, data }: { where: Partial<TokenRow>; data: Partial<TokenRow> }) => {
      const hits = tokens.filter(
        (t) =>
          (where.id === undefined || t.id === where.id) &&
          (where.user_id === undefined || t.user_id === where.user_id) &&
          (where.is_revoked === undefined || t.is_revoked === where.is_revoked),
      );
      hits.forEach((t) => Object.assign(t, data));
      return { count: hits.length };
    }),
  };
  const tx = { refreshToken };
  const prisma = { refreshToken, runInTransaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) };
  const users = {
    findForLogin: jest.fn(async (email: string) => (email.toLowerCase() === 'user@test.dev' ? user : null)),
    findAuthState: jest.fn(async (id: string) => (id === user.id ? user : null)),
    registerCustomer: jest.fn(),
    getMe: jest.fn(),
    setPasswordHash: jest.fn(),
    activateAccount: jest.fn(),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const config = {
    get: (key: string) => (key === 'JWT_ACCESS_SECRET' ? ACCESS_SECRET : key === 'JWT_REFRESH_SECRET' ? REFRESH_SECRET : undefined),
  };
  const technicianStatus: TechnicianProfileStatusPort = {
    getStatus: jest.fn(async () => overrides.technicianStatus ?? null),
  };
  const jwt = new JwtService({});
  const service = new AuthService(
    prisma as never,
    users as never,
    audit as never,
    jwt,
    config as never,
    technicianStatus,
  );
  return { service, user, tokens, users, audit, jwt, prisma, technicianStatus };
}

describe('AuthService.login', () => {
  it('returns a 15-minute access token, a refresh token and the user roles; stores only the refresh hash', async () => {
    const { service, tokens, jwt, audit } = await setup();
    const session = await service.login({ email: 'User@Test.dev', password: PASSWORD });

    expect(session.expiresInSeconds).toBe(900);
    const payload = await jwt.verifyAsync(session.accessToken, { secret: ACCESS_SECRET });
    expect(payload).toMatchObject({ sub: 'u1', roles: [Role.CUSTOMER] });
    expect(payload.exp - payload.iat).toBe(900);
    expect(session.user).toEqual({ id: 'u1', roles: [Role.CUSTOMER], technicianProfileStatus: null });

    expect(tokens).toHaveLength(1);
    expect(tokens[0].token_hash).toBe(sha256(session.refreshToken));
    expect(JSON.stringify(tokens)).not.toContain(session.refreshToken);
    const days = (session.refreshExpiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.LOGIN, actorId: 'u1' }), expect.anything());
  });

  it('rejects a wrong password and audits LOGIN_FAILED', async () => {
    const { service, audit, tokens } = await setup();
    await expect(service.login({ email: 'user@test.dev', password: 'nope' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.LOGIN_FAILED, actorId: 'u1' }));
    expect(tokens).toHaveLength(0);
  });

  it('gives the identical error for an unknown email and for a wrong password', async () => {
    const { service } = await setup();
    const wrongPassword = await service.login({ email: 'user@test.dev', password: 'nope' }).catch((e) => e);
    const unknownEmail = await service.login({ email: 'ghost@test.dev', password: PASSWORD }).catch((e) => e);
    expect(unknownEmail).toBeInstanceOf(UnauthorizedException);
    expect(unknownEmail.getStatus()).toBe(wrongPassword.getStatus());
    expect(unknownEmail.getResponse()).toEqual(wrongPassword.getResponse());
  });

  it('audits an unknown email with a null actor and no email in the row', async () => {
    const { service, audit } = await setup();
    await service.login({ email: 'ghost@test.dev', password: 'x' }).catch(() => undefined);
    const entry = audit.log.mock.calls[0][0];
    expect(entry).toMatchObject({ actorId: null, action: AuditAction.LOGIN_FAILED, entityId: 'unknown' });
    expect(JSON.stringify(entry)).not.toContain('ghost@test.dev');
  });

  it('does not let an inactive account log in, even with the right password, and gives the same error', async () => {
    const { service, tokens } = await setup({ active: false });
    const error = await service.login({ email: 'user@test.dev', password: PASSWORD }).catch((e) => e);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.getResponse()).toMatchObject({ message: 'Invalid email or password' });
    expect(tokens).toHaveLength(0);
  });

  it('lets a PENDING_REVIEW technician log in and returns the profile status', async () => {
    const { service } = await setup({ technicianStatus: ProfileStatus.PENDING_REVIEW });
    const session = await service.login({ email: 'user@test.dev', password: PASSWORD });
    expect(session.user.technicianProfileStatus).toBe(ProfileStatus.PENDING_REVIEW);
  });
});

describe('AuthService.refresh', () => {
  it('rotates: the old token is revoked, a new one is issued and the old one stops working', async () => {
    const { service, tokens } = await setup();
    const first = await service.login({ email: 'user@test.dev', password: PASSWORD });
    const second = await service.refresh(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(tokens.find((t) => t.token_hash === sha256(first.refreshToken))?.is_revoked).toBe(true);
    expect(tokens.find((t) => t.token_hash === sha256(second.refreshToken))?.is_revoked).toBe(false);

    await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('treats reuse of a revoked token as theft and revokes every session of that user', async () => {
    const { service, tokens } = await setup();
    const first = await service.login({ email: 'user@test.dev', password: PASSWORD });
    const second = await service.refresh(first.refreshToken);

    await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tokens.every((t) => t.is_revoked)).toBe(true);
    await expect(service.refresh(second.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a missing, malformed or wrongly signed token', async () => {
    const { service, jwt } = await setup();
    await expect(service.refresh(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.refresh('garbage')).rejects.toBeInstanceOf(UnauthorizedException);
    const forged = await jwt.signAsync({ sub: 'u1' }, { secret: 'c'.repeat(40) });
    await expect(service.refresh(forged)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an access token presented as a refresh token', async () => {
    const { service } = await setup();
    const session = await service.login({ email: 'user@test.dev', password: PASSWORD });
    await expect(service.refresh(session.accessToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired refresh token', async () => {
    const { service, tokens } = await setup();
    const session = await service.login({ email: 'user@test.dev', password: PASSWORD });
    tokens[0].expires_at = new Date(Date.now() - 1000);
    await expect(service.refresh(session.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects refresh for a user who was deactivated after logging in, and revokes the token', async () => {
    const { service, user, tokens } = await setup();
    const session = await service.login({ email: 'user@test.dev', password: PASSWORD });
    user.is_active = false;
    await expect(service.refresh(session.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tokens[0].is_revoked).toBe(true);
  });
});

describe('AuthService.logout', () => {
  it('revokes the token and audits LOGOUT', async () => {
    const { service, tokens, audit } = await setup();
    const session = await service.login({ email: 'user@test.dev', password: PASSWORD });
    await service.logout(session.refreshToken);
    expect(tokens[0].is_revoked).toBe(true);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.LOGOUT }), expect.anything());
    await expect(service.refresh(session.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('is a quiet no-op without a cookie', async () => {
    const { service } = await setup();
    await expect(service.logout(undefined)).resolves.toBeUndefined();
  });
});

describe('AuthService.changePassword', () => {
  it('rejects a wrong current password', async () => {
    const { service, users } = await setup();
    await expect(service.changePassword('u1', { old_password: 'nope', new_password: 'another-password' })).rejects.toMatchObject({
      code: 'WRONG_PASSWORD',
    });
    expect(users.setPasswordHash).not.toHaveBeenCalled();
  });

  it('rejects an unchanged password', async () => {
    const { service } = await setup();
    await expect(service.changePassword('u1', { old_password: PASSWORD, new_password: PASSWORD })).rejects.toMatchObject({
      code: 'PASSWORD_UNCHANGED',
    });
  });

  it('stores the new hash, revokes all sessions and audits PASSWORD_CHANGED in one transaction', async () => {
    const { service, users, tokens, audit, prisma } = await setup();
    await service.login({ email: 'user@test.dev', password: PASSWORD });
    await service.changePassword('u1', { old_password: PASSWORD, new_password: 'another-password' });

    expect(prisma.runInTransaction).toHaveBeenCalledTimes(2); // login + change
    expect(users.setPasswordHash).toHaveBeenCalledWith('u1', expect.stringMatching(/^\$argon2id\$/), expect.anything());
    expect(tokens.every((t) => t.is_revoked)).toBe(true);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.PASSWORD_CHANGED }), expect.anything());
  });
});

describe('AuthService.register', () => {
  it('delegates to the users module (customer only)', async () => {
    const { service, users } = await setup();
    users.registerCustomer.mockResolvedValue({ id: 'new' });
    const dto = { email: 'n@test.dev', password: 'password123', first_name: 'N', last_name: 'M' };
    await expect(service.register(dto)).resolves.toEqual({ id: 'new' });
    expect(users.registerCustomer).toHaveBeenCalledWith(dto);
  });
});
