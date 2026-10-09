import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';
import { JwtAuthGuard, RolesGuard } from './guards';

const SECRET = 's'.repeat(40);
const config = { get: () => SECRET } as never;

function context(req: object, meta: Record<string, unknown> = {}): ExecutionContext {
  const handler = () => undefined;
  class Controller {}
  Reflect.defineMetadata(IS_PUBLIC_KEY, meta[IS_PUBLIC_KEY], handler);
  Reflect.defineMetadata(ROLES_KEY, meta[ROLES_KEY], handler);
  return {
    getHandler: () => handler,
    getClass: () => Controller,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const jwt = new JwtService({});
  const guard = new JwtAuthGuard(new Reflector(), jwt, config);

  it('lets @Public() routes through without a token', async () => {
    await expect(guard.canActivate(context({ headers: {} }, { [IS_PUBLIC_KEY]: true }))).resolves.toBe(true);
  });

  it('rejects a request without a token', async () => {
    await expect(guard.canActivate(context({ headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a bad token and a token signed with another secret', async () => {
    await expect(guard.canActivate(context({ headers: { authorization: 'Bearer nope' } }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const forged = await jwt.signAsync({ sub: 'u1', roles: [Role.MANAGER] }, { secret: 'x'.repeat(40) });
    await expect(guard.canActivate(context({ headers: { authorization: `Bearer ${forged}` } }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an expired token', async () => {
    const expired = await jwt.signAsync({ sub: 'u1', roles: [] }, { secret: SECRET, expiresIn: -10 });
    await expect(guard.canActivate(context({ headers: { authorization: `Bearer ${expired}` } }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('attaches the user from a valid token', async () => {
    const token = await jwt.signAsync({ sub: 'u1', roles: [Role.CUSTOMER] }, { secret: SECRET, expiresIn: 60 });
    const req: { headers: object; user?: unknown } = { headers: { authorization: `Bearer ${token}` } };
    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(req.user).toEqual({ id: 'u1', roles: [Role.CUSTOMER] });
  });
});

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows any signed-in user when no roles are required', () => {
    expect(guard.canActivate(context({ user: { id: 'u1', roles: [Role.CUSTOMER] } }))).toBe(true);
  });

  it('answers 403 when the user lacks the role (a customer on a manager route)', () => {
    const ctx = context({ user: { id: 'u1', roles: [Role.CUSTOMER] } }, { [ROLES_KEY]: [Role.MANAGER] });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows a user holding any of the required roles', () => {
    const ctx = context({ user: { id: 'u1', roles: [Role.DISPATCHER] } }, { [ROLES_KEY]: [Role.MANAGER, Role.DISPATCHER] });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
