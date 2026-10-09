import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditAction, CommissionTierName, MaintenanceCategory, ProfileStatus, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { hashPassword } from '../src/common/password';
import { PrismaService } from '../src/infra/prisma/prisma.service';

const API = '/api/v1';
const PASSWORD = 'e2e-password-123';

describe('technician signup and applications (e2e, throwaway database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let skillIds: string[];
  const http = () => request(app.getHttpServer());

  const details = (extra: Record<string, unknown> = {}) => ({
    skills: [
      { skill_id: skillIds[0], proficiency_level: 4 },
      { skill_id: skillIds[1], proficiency_level: 3 },
    ],
    years_of_experience: 6,
    bio: 'Six years repairing split and central AC units for homes.',
    normal_rate: 30,
    emergency_rate: 50,
    proposed_tier: 'SILVER',
    supporting_notes: 'HVAC certificate',
    ...extra,
  });

  const register = (email: string, extra: Record<string, unknown> = {}) =>
    http()
      .post(`${API}/auth/register/technician`)
      .send({ email, password: PASSWORD, first_name: 'Ali', last_name: 'Tech', application: details(extra) });

  async function login(email: string): Promise<string> {
    const res = await http().post(`${API}/auth/login`).send({ email, password: PASSWORD }).expect(200);
    return res.body.accessToken as string;
  }
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function managerToken(): Promise<string> {
    await prisma.user.upsert({
      where: { email: 'tech-manager@test.dev' },
      update: {},
      create: {
        email: 'tech-manager@test.dev',
        password_hash: await hashPassword(PASSWORD),
        first_name: 'Man',
        last_name: 'Ager',
        roles: { create: { role: Role.MANAGER } },
      },
    });
    return login('tech-manager@test.dev');
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    // Reference data is not part of the migrations or the manager seed.
    for (const name of [CommissionTierName.BRONZE, CommissionTierName.SILVER]) {
      await prisma.commissionTier.upsert({ where: { name }, update: {}, create: { name, commission_rate: 12 } });
    }
    for (const name of ['AC repair', 'AC installation']) {
      await prisma.skill.upsert({ where: { name }, update: {}, create: { name, category: MaintenanceCategory.HVAC } });
    }
    const res = await http().get(`${API}/skills`).expect(200);
    skillIds = res.body.map((s: { id: string }) => s.id);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /skills is public', async () => {
    expect(skillIds.length).toBeGreaterThanOrEqual(2);
  });

  it('validates the application template', async () => {
    await register('bad1@test.dev', { skills: [] }).expect(400);
    await register('bad2@test.dev', { emergency_rate: 10 }).expect(400);
    await register('bad3@test.dev', {
      skills: [{ skill_id: '00000000-0000-4000-8000-000000000000', proficiency_level: 3 }],
    }).expect(400);
    expect(await prisma.user.findUnique({ where: { email: 'bad2@test.dev' } })).toBeNull();
  });

  it('the applicant waits as PENDING_REVIEW, can sign in and see the status, and the manager approves', async () => {
    const reg = await register('tech1@test.dev').expect(201);
    expect(reg.body.user.roles).toEqual([Role.TECHNICIAN]);
    expect(reg.body.status).toBe('PENDING');

    const loginRes = await http().post(`${API}/auth/login`).send({ email: 'tech1@test.dev', password: PASSWORD }).expect(200);
    expect(loginRes.body.user.technicianProfileStatus).toBe(ProfileStatus.PENDING_REVIEW);
    const applicant = loginRes.body.accessToken as string;

    const mine = await http().get(`${API}/technician-applications/mine`).set(bearer(applicant)).expect(200);
    expect(mine.body).toMatchObject({ status: 'PENDING', profile_status: 'PENDING_REVIEW', job_categories: ['HVAC'] });
    expect(mine.body.skills).toHaveLength(2);

    // Applicants cannot reach manager routes or decide their own application.
    await http().get(`${API}/technician-tier-requests`).set(bearer(applicant)).expect(403);
    await http()
      .patch(`${API}/technician-tier-requests/${reg.body.application_id}`)
      .set(bearer(applicant))
      .send({ decision: 'APPROVED' })
      .expect(403);

    const manager = await managerToken();
    const pending = await http().get(`${API}/technician-tier-requests?status=PENDING`).set(bearer(manager)).expect(200);
    expect(pending.body.data.some((a: { id: string }) => a.id === reg.body.application_id)).toBe(true);

    const decided = await http()
      .patch(`${API}/technician-tier-requests/${reg.body.application_id}`)
      .set(bearer(manager))
      .send({ decision: 'APPROVED', normal_rate: 28 })
      .expect(200);
    expect(decided.body).toMatchObject({ status: 'APPROVED', profile_status: 'APPROVED' });
    expect(decided.body.final_tier.name).toBe('SILVER');

    // A second decision is refused, and the approval is audited.
    await http()
      .patch(`${API}/technician-tier-requests/${reg.body.application_id}`)
      .set(bearer(manager))
      .send({ decision: 'REJECTED', review_notes: 'late' })
      .expect(409);
    const profile = await prisma.technicianProfile.findFirstOrThrow({ where: { user: { email: 'tech1@test.dev' } } });
    expect(profile.normal_rate.toString()).toBe('28');
    expect(await prisma.auditLog.count({ where: { entity_id: profile.id, action: AuditAction.TECHNICIAN_APPROVED } })).toBe(1);
  });

  it('a rejected technician sees the reason and can re-apply once; a pending one cannot', async () => {
    const reg = await register('tech2@test.dev').expect(201);
    const manager = await managerToken();

    await http()
      .patch(`${API}/technician-tier-requests/${reg.body.application_id}`)
      .set(bearer(manager))
      .send({ decision: 'REJECTED' })
      .expect(400); // a reason is required
    await http()
      .patch(`${API}/technician-tier-requests/${reg.body.application_id}`)
      .set(bearer(manager))
      .send({ decision: 'REJECTED', review_notes: 'Insufficient certification' })
      .expect(200);

    const token = await login('tech2@test.dev');
    const mine = await http().get(`${API}/technician-applications/mine`).set(bearer(token)).expect(200);
    expect(mine.body).toMatchObject({ profile_status: 'REJECTED', review_notes: 'Insufficient certification' });

    const again = await http()
      .post(`${API}/technician-applications/reapply`)
      .set(bearer(token))
      .send(details({ years_of_experience: 7, supporting_notes: 'Added a new certificate' }))
      .expect(201);
    expect(again.body.application_id).not.toBe(reg.body.application_id);

    const after = await http().get(`${API}/technician-applications/mine`).set(bearer(token)).expect(200);
    expect(after.body).toMatchObject({ status: 'PENDING', profile_status: 'PENDING_REVIEW', years_of_experience: 7 });

    await http().post(`${API}/technician-applications/reapply`).set(bearer(token)).send(details()).expect(409);

    const approved = await http()
      .patch(`${API}/technician-tier-requests/${again.body.application_id}`)
      .set(bearer(manager))
      .send({ decision: 'APPROVED' })
      .expect(200);
    expect(approved.body.profile_status).toBe('APPROVED');
  });

  it('rejects a duplicate email and a self-assigned role', async () => {
    await register('tech1@test.dev').expect(409);
    await http()
      .post(`${API}/auth/register/technician`)
      .send({ email: 'sneaky@test.dev', password: PASSWORD, first_name: 'S', last_name: 'N', role: 'MANAGER', application: details() })
      .expect(400);
  });
});
