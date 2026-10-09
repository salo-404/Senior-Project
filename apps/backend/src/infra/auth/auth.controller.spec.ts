import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { ErrorFilter } from '../../common/error.filter';
import { TechniciansService } from '../../modules/technicians/technicians.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController (rate limit, validation, cookie)', () => {
  let app: INestApplication;
  const auth = {
    login: jest.fn(),
    refresh: jest.fn(),
    register: jest.fn(),
    logout: jest.fn(),
  };
  const technicians = { registerApplicant: jest.fn() };

  beforeAll(async () => {
    delete process.env.LOGIN_RATE_LIMIT; // use the default of 5 per minute
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 1000 }] })],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: TechniciansService, useValue: technicians },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ErrorFilter());
    await app.init();
  });

  afterAll(() => app.close());

  it('allows 5 login attempts per minute and answers the 6th with 429', async () => {
    auth.login.mockRejectedValue(new UnauthorizedException('Invalid email or password'));
    const attempt = () => request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'x' });

    for (let i = 0; i < 5; i++) {
      await attempt().expect(401);
    }
    const blocked = await attempt().expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(auth.login).toHaveBeenCalledTimes(5);
  });

  it('rejects a role in the register body (the role is never read from the request)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'a@b.co', password: 'password123', first_name: 'A', last_name: 'B', role: 'MANAGER' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.error.details)).toContain('role');
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('validates the technician application template before calling the technicians module', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/register/technician').send({}).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(technicians.registerApplicant).not.toHaveBeenCalled();
  });
});

describe('AuthController login cookie', () => {
  let app: INestApplication;
  const auth = { login: jest.fn() };

  beforeAll(async () => {
    process.env.LOGIN_RATE_LIMIT = '1000';
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: TechniciansService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    delete process.env.LOGIN_RATE_LIMIT;
    await app.close();
  });

  it('sets an httpOnly, Secure, SameSite=Strict refresh cookie limited to the auth path and keeps it out of the body', async () => {
    auth.login.mockResolvedValue({
      accessToken: 'access',
      expiresInSeconds: 900,
      refreshToken: 'refresh-secret-value',
      refreshExpiresAt: new Date(Date.now() + 7 * 86_400_000),
      user: { id: 'u1', roles: ['CUSTOMER'], technicianProfileStatus: null },
    });
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.co', password: 'x' })
      .expect(200);

    expect(res.body.accessToken).toBe('access');
    expect(JSON.stringify(res.body)).not.toContain('refresh-secret-value');
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('refresh_token='))!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/v1/auth');
  });
});
