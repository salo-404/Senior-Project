import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditAction, NotificationType, Role } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { hashPassword } from '../src/common/password';
import { AuditService } from '../src/infra/audit/audit.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';

const API = '/api/v1';
const PASSWORD = 'e2e-password-123';

describe('maintAIn backend (e2e, AI_ENABLED=false, throwaway database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let audit: AuditService;
  const http = () => request(app.getHttpServer());

  const refreshCookie = (res: request.Response): string => {
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const cookie = cookies.find((c) => c.startsWith('refresh_token='));
    if (!cookie) throw new Error('no refresh cookie');
    return cookie.split(';')[0];
  };

  async function createUser(email: string, role: Role, active = true) {
    return prisma.user.create({
      data: {
        email,
        password_hash: await hashPassword(PASSWORD),
        first_name: 'Test',
        last_name: role,
        is_active: active,
        roles: { create: { role } },
        ...(role === Role.CUSTOMER ? { customer_profile: { create: {} } } : {}),
      },
    });
  }

  async function login(email: string) {
    const res = await http().post(`${API}/auth/login`).send({ email, password: PASSWORD }).expect(200);
    return { token: res.body.accessToken as string, cookie: refreshCookie(res), body: res.body };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    audit = app.get(AuditService);
  });

  afterAll(async () => {
    await app.close();
  });

  // ------------------------------------------------------------------ 1. register, login, roles

  describe('1. customer registration, login and role checks', () => {
    it('registers a customer, logs in, and gets 403 on a manager route', async () => {
      const reg = await http()
        .post(`${API}/auth/register`)
        .send({ email: 'Cust1@Test.dev', password: PASSWORD, first_name: 'Cu', last_name: 'St' })
        .expect(201);
      expect(reg.body.roles).toEqual([Role.CUSTOMER]);
      expect(JSON.stringify(reg.body)).not.toMatch(/password|hash/i);

      const { token, body } = await login('cust1@test.dev');
      expect(body.user.roles).toEqual([Role.CUSTOMER]);
      expect(body.refreshToken).toBeUndefined();

      const forbidden = await http()
        .post(`${API}/users`)
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'x@test.dev', first_name: 'X', last_name: 'Y', role: 'DISPATCHER' })
        .expect(403);
      expect(forbidden.body).toEqual({ error: { code: 'FORBIDDEN', message: expect.any(String), details: null } });

      const profile = await prisma.customerProfile.findFirst({ where: { user: { email: 'cust1@test.dev' } } });
      expect(profile).not.toBeNull();
    });

    it('requires a token on protected routes and has the documented error shape', async () => {
      const res = await http().get(`${API}/auth/me`).expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns the same error for a wrong password and an unknown email', async () => {
      const wrong = await http().post(`${API}/auth/login`).send({ email: 'cust1@test.dev', password: 'wrong-wrong' }).expect(401);
      const unknown = await http().post(`${API}/auth/login`).send({ email: 'nobody@test.dev', password: 'wrong-wrong' }).expect(401);
      expect(unknown.body).toEqual(wrong.body);
    });

    it('rotates the refresh token and revokes the old one', async () => {
      const first = await login('cust1@test.dev');
      const refreshed = await http().post(`${API}/auth/refresh`).set('Cookie', first.cookie).expect(200);
      expect(refreshed.body.accessToken).toBeTruthy();
      expect(refreshCookie(refreshed)).not.toBe(first.cookie);
      await http().post(`${API}/auth/refresh`).set('Cookie', first.cookie).expect(401);
    });

    it('lists users only for managers, with the { data, meta } shape', async () => {
      await createUser('manager-list@test.dev', Role.MANAGER);
      const { token } = await login('manager-list@test.dev');
      const res = await http().get(`${API}/users?page=1&pageSize=5`).set('Authorization', `Bearer ${token}`).expect(200);
      expect(res.body.meta).toMatchObject({ page: 1, pageSize: 5 });
      expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(JSON.stringify(res.body)).not.toMatch(/password_hash|activation_token/);
    });
  });

  // ------------------------------------------------------------------ 2. ownership: 404, not 403

  describe('2. a customer cannot read another user\'s notification or attachment', () => {
    it('answers 404 for someone else\'s notification and attachment, 200 for the owner', async () => {
      const a = await createUser('owner-a@test.dev', Role.CUSTOMER);
      await createUser('other-b@test.dev', Role.CUSTOMER);
      const tokenA = (await login('owner-a@test.dev')).token;
      const tokenB = (await login('other-b@test.dev')).token;

      const notification = await prisma.notification.create({
        data: { user_id: a.id, notification_type: NotificationType.SYSTEM, title: 'Hi', body: 'Only for A' },
      });
      const conversation = await prisma.aiConversation.create({
        data: { user_id: a.id, role: Role.CUSTOMER, messages: [] },
      });
      const attachment = await prisma.attachment.create({
        data: {
          user_id: a.id,
          conversation_id: conversation.id,
          purpose: 'CUSTOMER_PHOTO',
          file_url: 'customer_photo/e2e.png',
          file_type: 'image/png',
          file_size: 10,
        },
      });

      await http().patch(`${API}/notifications/${notification.id}/read`).set('Authorization', `Bearer ${tokenB}`).expect(404);
      await http().get(`${API}/attachments/${attachment.id}/url`).set('Authorization', `Bearer ${tokenB}`).expect(404);
      const listB = await http().get(`${API}/notifications`).set('Authorization', `Bearer ${tokenB}`).expect(200);
      expect(listB.body.data).toHaveLength(0);

      const unreadA = await http().get(`${API}/notifications/unread-count`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(unreadA.body).toEqual({ count: 1 });
      await http().patch(`${API}/notifications/${notification.id}/read`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      await http().post(`${API}/notifications/read-all`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      const url = await http().get(`${API}/attachments/${attachment.id}/url`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(url.body.expiresInSeconds).toBe(300);
      expect(url.body.url).toContain('customer_photo/e2e.png');

      // The notification was not marked read by B's attempt.
      const row = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
      expect(row.is_read).toBe(true); // by A, and only after A's own call
    });
  });

  // ------------------------------------------------------------------ 3 and 4. invite-only staff

  describe('3. invite-only staff activation', () => {
    let managerToken: string;

    beforeAll(async () => {
      await createUser('boss@test.dev', Role.MANAGER);
      managerToken = (await login('boss@test.dev')).token;
    });

    const invite = async (email: string, role: Role = Role.DISPATCHER) => {
      const res = await http()
        .post(`${API}/users`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ email, first_name: 'Dis', last_name: 'Patcher', role })
        .expect(201);
      return res.body as { user: { id: string; is_active: boolean }; activationToken: string; activationLink: string };
    };

    it('creates an inactive dispatcher whose token is stored hashed, and the token works exactly once', async () => {
      const created = await invite('dispatcher1@test.dev');
      expect(created.user.is_active).toBe(false);
      expect(created.activationLink).toContain(created.activationToken);

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: created.user.id } });
      expect(stored.activation_token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.activation_token_hash).not.toBe(created.activationToken);
      const hours = (stored.activation_expires_at!.getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(47.9);
      expect(hours).toBeLessThanOrEqual(48);

      // Cannot log in before activating.
      await http().post(`${API}/auth/login`).send({ email: 'dispatcher1@test.dev', password: PASSWORD }).expect(401);

      await http().post(`${API}/auth/activate`).send({ token: created.activationToken, password: PASSWORD }).expect(204);

      const activated = await prisma.user.findUniqueOrThrow({ where: { id: created.user.id } });
      expect(activated.is_active).toBe(true);
      expect(activated.activation_token_hash).toBeNull();
      expect(activated.activation_expires_at).toBeNull();

      // Reuse is rejected.
      const reuse = await http()
        .post(`${API}/auth/activate`)
        .send({ token: created.activationToken, password: 'another-password-1' })
        .expect(400);
      expect(reuse.body.error.code).toBe('INVALID_ACTIVATION_TOKEN');

      const { body } = await login('dispatcher1@test.dev');
      expect(body.user.roles).toEqual([Role.DISPATCHER]);

      const actions = (await audit.findByEntity('user', created.user.id)).map((r) => r.action);
      // Also holds the LOGIN_FAILED from the pre-activation attempt and the later LOGIN.
      expect(actions).toEqual(
        expect.arrayContaining([AuditAction.USER_CREATED, AuditAction.LOGIN_FAILED, AuditAction.ACCOUNT_ACTIVATED, AuditAction.LOGIN]),
      );
      expect(actions.indexOf(AuditAction.ACCOUNT_ACTIVATED)).toBeGreaterThan(actions.indexOf(AuditAction.USER_CREATED));
    });

    it('audits a role change as USER_ROLE_CHANGED and keeps at least one manager', async () => {
      const created = await invite('dispatcher-role@test.dev');
      await http().post(`${API}/auth/activate`).send({ token: created.activationToken, password: PASSWORD }).expect(204);

      const changed = await http()
        .patch(`${API}/users/${created.user.id}/role`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ role: 'MANAGER' })
        .expect(200);
      expect(changed.body.roles).toEqual([Role.MANAGER]);
      const rows = await audit.findByEntity('user', created.user.id);
      expect(rows.map((r) => r.action)).toContain(AuditAction.USER_ROLE_CHANGED);
    });

    it('rejects an expired token', async () => {
      const created = await invite('dispatcher-expired@test.dev');
      await prisma.user.update({
        where: { id: created.user.id },
        data: { activation_expires_at: new Date(Date.now() - 60_000) },
      });
      const res = await http()
        .post(`${API}/auth/activate`)
        .send({ token: created.activationToken, password: PASSWORD })
        .expect(400);
      expect(res.body.error.code).toBe('INVALID_ACTIVATION_TOKEN');
      const user = await prisma.user.findUniqueOrThrow({ where: { id: created.user.id } });
      expect(user.is_active).toBe(false);
    });

    it('rejects an unknown token with the same error', async () => {
      const res = await http()
        .post(`${API}/auth/activate`)
        .send({ token: 'definitely-not-a-real-token', password: PASSWORD })
        .expect(400);
      expect(res.body.error.code).toBe('INVALID_ACTIVATION_TOKEN');
    });

    it('audits USER_CREATED for the invite', async () => {
      const created = await invite('dispatcher-audit@test.dev');
      const rows = await audit.findByEntity('user', created.user.id);
      expect(rows.map((r) => r.action)).toEqual([AuditAction.USER_CREATED]);
      expect(JSON.stringify(rows)).not.toContain(created.activationToken);
    });

    it('only a manager can invite, and the role cannot be CUSTOMER or TECHNICIAN', async () => {
      const bad = await http()
        .post(`${API}/users`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ email: 'x@test.dev', first_name: 'X', last_name: 'Y', role: 'TECHNICIAN' })
        .expect(400);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('4. deactivating a dispatcher stops refresh', () => {
    it('blocks refresh and login after the manager deactivates the account', async () => {
      await createUser('boss2@test.dev', Role.MANAGER);
      const managerToken = (await login('boss2@test.dev')).token;
      const dispatcher = await createUser('dispatcher2@test.dev', Role.DISPATCHER);
      const session = await login('dispatcher2@test.dev');

      await http().post(`${API}/auth/refresh`).set('Cookie', session.cookie).expect(200);
      const second = await login('dispatcher2@test.dev');

      await http()
        .patch(`${API}/users/${dispatcher.id}/deactivate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      await http().post(`${API}/auth/refresh`).set('Cookie', second.cookie).expect(401);
      await http().post(`${API}/auth/login`).send({ email: 'dispatcher2@test.dev', password: PASSWORD }).expect(401);

      const rows = await audit.findByEntity('user', dispatcher.id);
      expect(rows.map((r) => r.action)).toContain(AuditAction.USER_DEACTIVATED);
    });

    it('a manager cannot deactivate or re-role themselves', async () => {
      const self = await createUser('boss3@test.dev', Role.MANAGER);
      const { token } = await login('boss3@test.dev');
      await http().patch(`${API}/users/${self.id}/deactivate`).set('Authorization', `Bearer ${token}`).expect(409);
      await http().patch(`${API}/users/${self.id}/role`).set('Authorization', `Bearer ${token}`).send({ role: 'DISPATCHER' }).expect(403);
    });
  });

  // ------------------------------------------------------------------ 5. health

  describe('5. GET /health', () => {
    it('reports ollama as down (and redis/storage), never crashes, and the app keeps serving', async () => {
      const res = await http().get(`${API}/health`).expect(200);
      expect(res.body).toMatchObject({ db: 'up', ollama: 'down', redis: 'down', storage: 'down' });
      // Still alive afterwards.
      await http().get(`${API}/health`).expect(200);
      await http().post(`${API}/auth/login`).send({ email: 'cust1@test.dev', password: PASSWORD }).expect(200);
    });
  });

  // ------------------------------------------------------------------ 6. audit in the same transaction

  describe('6. audit rows commit or roll back with the change they describe', () => {
    it('writes the data change and its audit row together', async () => {
      const user = await createUser('tx-ok@test.dev', Role.CUSTOMER);
      await prisma.runInTransaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { first_name: 'Changed' } });
        await audit.log(
          { actorId: user.id, action: AuditAction.USER_UPDATED, entityType: 'user', entityId: user.id, newValue: { first_name: 'Changed' } },
          tx,
        );
      });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).first_name).toBe('Changed');
      expect(await audit.findByEntity('user', user.id)).toHaveLength(1);
    });

    it('rolls back BOTH when something fails after the audit call', async () => {
      const user = await createUser('tx-fail@test.dev', Role.CUSTOMER);
      await expect(
        prisma.runInTransaction(async (tx) => {
          await tx.user.update({ where: { id: user.id }, data: { first_name: 'ShouldNotStick' } });
          await audit.log(
            { actorId: user.id, action: AuditAction.USER_UPDATED, entityType: 'user', entityId: user.id, newValue: { first_name: 'ShouldNotStick' } },
            tx,
          );
          throw new Error('forced failure after the audit call');
        }),
      ).rejects.toThrow('forced failure');

      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).first_name).toBe('Test');
      expect(await audit.findByEntity('user', user.id)).toHaveLength(0);
    });

    it('audit rows are immutable (the database trigger rejects update and delete)', async () => {
      const user = await createUser('immutable@test.dev', Role.CUSTOMER);
      await audit.log({ actorId: user.id, action: AuditAction.LOGOUT, entityType: 'user', entityId: user.id });
      const [row] = await audit.findByEntity('user', user.id);
      await expect(prisma.auditLog.update({ where: { id: row.id }, data: { entity_type: 'x' } })).rejects.toThrow();
      await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
    });
  });

  // ------------------------------------------------------------------ 7. role in the register body

  describe('7. a role in the register body is rejected', () => {
    it.each(['MANAGER', 'DISPATCHER', 'TECHNICIAN', 'CUSTOMER'])('role=%s', async (role) => {
      const res = await http()
        .post(`${API}/auth/register`)
        .send({ email: `role-${role}@test.dev`, password: PASSWORD, first_name: 'R', last_name: 'R', role })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(await prisma.user.findUnique({ where: { email: `role-${role}@test.dev` } })).toBeNull();
    });

    it('technician registration validates its application template (an empty body is a 400)', async () => {
      const res = await http().post(`${API}/auth/register/technician`).send({}).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unknown fields and bad input with VALIDATION_ERROR', async () => {
      const res = await http().post(`${API}/auth/register`).send({ email: 'not-an-email', password: 'short' }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ------------------------------------------------------------------ extras

  describe('password change and logout', () => {
    it('change-password revokes sessions; logout revokes the cookie token', async () => {
      await createUser('pw@test.dev', Role.CUSTOMER);
      const session = await login('pw@test.dev');
      await http()
        .post(`${API}/auth/change-password`)
        .set('Authorization', `Bearer ${session.token}`)
        .send({ old_password: PASSWORD, new_password: 'brand-new-password-1' })
        .expect(204);
      await http().post(`${API}/auth/refresh`).set('Cookie', session.cookie).expect(401);
      await http().post(`${API}/auth/login`).send({ email: 'pw@test.dev', password: PASSWORD }).expect(401);

      const again = await http().post(`${API}/auth/login`).send({ email: 'pw@test.dev', password: 'brand-new-password-1' }).expect(200);
      const cookie = refreshCookie(again);
      await http().post(`${API}/auth/logout`).set('Cookie', cookie).expect(204);
      await http().post(`${API}/auth/refresh`).set('Cookie', cookie).expect(401);
    });
  });

  describe('seed script', () => {
    const run = (env: Record<string, string | undefined>) => {
      try {
        const out = execFileSync('npx', ['tsx', 'prisma/seed.ts'], {
          cwd: join(__dirname, '..'),
          env: { ...process.env, SEED_MANAGER_EMAIL: '', SEED_MANAGER_PASSWORD: '', ...env } as NodeJS.ProcessEnv,
          encoding: 'utf8',
          shell: true,
        });
        return { code: 0, out };
      } catch (err) {
        const e = err as { status: number; stderr: string };
        return { code: e.status, out: e.stderr };
      }
    };

    it('refuses to run without credentials, creates the manager once, and is idempotent', async () => {
      expect(run({}).code).toBe(1);
      expect(run({ SEED_MANAGER_EMAIL: 'seed@test.dev', SEED_MANAGER_PASSWORD: 'short' }).code).toBe(1);

      const env = { SEED_MANAGER_EMAIL: 'Seed@Test.dev', SEED_MANAGER_PASSWORD: 'a-long-seed-password-1' };
      expect(run(env).code).toBe(0);
      expect(run(env).out).toContain('already exists');
      expect(await prisma.user.count({ where: { email: 'seed@test.dev' } })).toBe(1);

      await http().post(`${API}/auth/login`).send({ email: 'seed@test.dev', password: env.SEED_MANAGER_PASSWORD }).expect(200);
    }, 120_000);
  });
});
