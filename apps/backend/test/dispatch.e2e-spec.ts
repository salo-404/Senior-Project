import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AssignmentStatus,
  AuditAction,
  MaintenanceCategory,
  NotificationType,
  ProfileStatus,
  RequestStatus,
  Role,
} from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { hashPassword } from '../src/common/password';
import { AuditService } from '../src/infra/audit/audit.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';

const API = '/api/v1';
const PASSWORD = 'e2e-password-123';

interface TechOptions {
  status?: ProfileStatus;
  available?: boolean;
  blocked?: boolean;
  years?: number;
  rating?: number;
  reviews?: number;
  normalRate?: number;
  emergencyRate?: number;
  skills?: { id: string; level: number }[];
}

describe('Stage 3: dispatch, ranking and assignment (e2e, throwaway database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const profileIds: Record<string, string> = {};
  let hvacSkill: string;
  let applianceSkill: string;
  let typeId: string;
  let addressId: string;
  let equipmentId: string;

  const as = (key: string) => ({ Authorization: `Bearer ${tokens[key]}` });

  async function login(key: string) {
    const res = await http().post(`${API}/auth/login`).send({ email: `${key.toLowerCase()}@test.dev`, password: PASSWORD }).expect(200);
    tokens[key] = res.body.accessToken;
  }

  async function createUser(key: string, role: Role) {
    const user = await prisma.user.create({
      data: {
        email: `${key.toLowerCase()}@test.dev`,
        password_hash: await hashPassword(PASSWORD),
        first_name: key,
        last_name: role,
        is_active: true,
        roles: { create: { role } },
        ...(role === Role.CUSTOMER ? { customer_profile: { create: {} } } : {}),
      },
    });
    ids[key] = user.id;
    await login(key);
  }

  async function createTech(key: string, o: TechOptions = {}) {
    const user = await prisma.user.create({
      data: {
        email: `${key.toLowerCase()}@test.dev`,
        password_hash: await hashPassword(PASSWORD),
        first_name: key,
        last_name: 'Tech',
        is_active: true,
        roles: { create: { role: Role.TECHNICIAN } },
        technician_profile: {
          create: {
            profile_status: o.status ?? ProfileStatus.APPROVED,
            is_available: o.available ?? true,
            is_payment_blocked: o.blocked ?? false,
            years_of_experience: o.years ?? 5,
            rating: o.rating ?? 4,
            total_reviews: o.reviews ?? 10,
            normal_rate: o.normalRate ?? 20,
            emergency_rate: o.emergencyRate ?? 30,
            skills: { create: (o.skills ?? [{ id: hvacSkill, level: 4 }]).map((s) => ({ skill_id: s.id, proficiency_level: s.level })) },
          },
        },
      },
      include: { technician_profile: true },
    });
    ids[key] = user.id;
    profileIds[key] = user.technician_profile!.id;
    await login(key);
  }

  /** A customer case taken through the dispatcher review to APPROVED. `kind`: true = emergency, 'URGENT', or normal. */
  async function approvedCase(kind: boolean | 'URGENT' = false): Promise<string> {
    const emergency = kind === true;
    const body = emergency
      ? { equipment_id: equipmentId, address_id: addressId, description: 'Smoke from the unit', contact_preference: 'FORM' }
      : {
          equipment_id: equipmentId,
          address_id: addressId,
          title: 'AC not cooling',
          description: 'The AC blows warm air since yesterday.',
          ...(kind === 'URGENT' ? { priority: 'URGENT' } : {}),
        };
    const created = await http().post(`${API}/requests${emergency ? '/emergency' : ''}`).set(as('customer')).send(body).expect(201);
    const id = created.body.id as string;
    await http().post(`${API}/cases/${id}/review`).set(as('dispatcher')).send({ action: 'START' }).expect(200);
    await http().post(`${API}/cases/${id}/review`).set(as('dispatcher')).send({ action: 'APPROVE' }).expect(200);
    return id;
  }

  const ranking = (id: string, who = 'dispatcher') => http().get(`${API}/cases/${id}/technician-ranking`).set(as(who));
  const assign = (id: string, body: Record<string, unknown>, who = 'dispatcher') =>
    http().post(`${API}/cases/${id}/assignments`).set(as(who)).send(body);

  // NOTE(plan-alignment): availability follows the backend plan: 1 - open assignments / 3, and a technician with
  // 3 open assignments (PENDING, ACCEPTED or IN_PROGRESS) is left out of the ranking altogether.
  const OPEN = [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED, AssignmentStatus.IN_PROGRESS];
  const openJobs = (profileId: string) =>
    prisma.assignment.count({ where: { technician_profile_id: profileId, status: { in: OPEN } } });

  /** Brings a technician to exactly 3 open assignments through the real endpoint; returns the ones it created. */
  async function fillToLimit(profileId: string): Promise<string[]> {
    const created: string[] = [];
    while ((await openJobs(profileId)) < 3) {
      const caseId = await approvedCase();
      const res = await assign(caseId, { technician_profile_id: profileId }).expect(201);
      created.push(res.body.id);
    }
    return created;
  }
  const release = (assignmentIds: string[]) =>
    prisma.assignment.updateMany({ where: { id: { in: assignmentIds } }, data: { status: AssignmentStatus.CANCELLED } });

  const setAllAvailability = (available: boolean) =>
    prisma.technicianProfile.updateMany({ where: { id: { in: Object.values(profileIds) } }, data: { is_available: available } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    // Listening up front lets the two parallel requests in the race test share one server.
    await app.listen(0);
    prisma = app.get(PrismaService);

    hvacSkill = (await prisma.skill.create({ data: { name: 'AC repair', category: MaintenanceCategory.HVAC } })).id;
    applianceSkill = (await prisma.skill.create({ data: { name: 'Fridge repair', category: MaintenanceCategory.HOME_APPLIANCES } })).id;
    typeId = (await prisma.equipmentType.create({ data: { name: 'Split air conditioner', category: MaintenanceCategory.HVAC } })).id;

    await createUser('customer', Role.CUSTOMER);
    await createUser('dispatcher', Role.DISPATCHER);
    await createUser('manager', Role.MANAGER);

    // star: best on every factor. mid: weaker and dearer. The next three are excluded for different reasons.
    await createTech('star', { skills: [{ id: hvacSkill, level: 5 }], years: 10, rating: 5, reviews: 10, normalRate: 20, emergencyRate: 30 });
    await createTech('mid', { skills: [{ id: hvacSkill, level: 3 }], years: 2, rating: 3, reviews: 10, normalRate: 40, emergencyRate: 60 });
    await createTech('off', { available: false });
    await createTech('blocked', { blocked: true });
    await createTech('fridge', { skills: [{ id: applianceSkill, level: 5 }] });
    await createTech('applicant', { status: ProfileStatus.PENDING_REVIEW });

    addressId = (await http().post(`${API}/addresses`).set(as('customer')).send({ street: '1 Main St', city: 'Beirut' }).expect(201)).body.id;
    equipmentId = (
      await http().post(`${API}/equipment`).set(as('customer')).send({ equipment_type_id: typeId, address_id: addressId, name: 'Living room AC' }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ------------------------------------------------------------------ ranking

  describe('the ranking', () => {
    it('is for dispatchers only and only for an approved case', async () => {
      const created = await http()
        .post(`${API}/requests`)
        .set(as('customer'))
        .send({ equipment_id: equipmentId, address_id: addressId, title: 'AC', description: 'The AC is broken for days now.' })
        .expect(201);
      const stillNew = await ranking(created.body.id).expect(409);
      expect(stillNew.body.error.code).toBe('NOT_APPROVED');

      const approved = await approvedCase();
      await ranking(approved, 'customer').expect(403);
      await ranking(approved, 'star').expect(403);
      await ranking(approved, 'manager').expect(403);
      await http().get(`${API}/cases/00000000-0000-4000-8000-000000000000/technician-ranking`).set(as('dispatcher')).expect(404);
    });

    it('returns eligible technicians best-first with every factor, the weights and the score', async () => {
      const id = await approvedCase();
      const res = await ranking(id).expect(200);

      expect(res.body).toMatchObject({ priority: 'NORMAL', category: 'HVAC', rateType: 'NORMAL' });
      expect(res.body.weights).toEqual({ skill: 0.3, availability: 0.3, experience: 0.15, feedback: 0.15, rate: 0.1 });
      // star: every factor 1 -> 100.  mid: .3*.6 + .3 + .15*.2 + .15*.6 + .1*0 = .6 -> 60
      expect(res.body.ranking.map((r: { name: string; rank: number; score: number }) => [r.name, r.rank, r.score])).toEqual([
        ['star Tech', 1, 100],
        ['mid Tech', 2, 60],
      ]);
      expect(res.body.ranking[0].factors).toEqual({ skill: 1, availability: 1, experience: 1, feedback: 1, rate: 1 });
      expect(res.body.ranking[1].factors).toEqual({ skill: 0.6, availability: 1, experience: 0.2, feedback: 0.6, rate: 0 });
      expect(res.body.ranking[0].contributions).toEqual({ skill: 30, availability: 30, experience: 15, feedback: 15, rate: 10 });
    });

    it('explains why approved technicians were left out, and never lists applicants', async () => {
      const id = await approvedCase();
      const res = await ranking(id).expect(200);
      const byName = Object.fromEntries(res.body.excluded.map((e: { name: string; reasons: string[] }) => [e.name, e.reasons]));
      expect(byName).toEqual({
        'off Tech': ['NOT_AVAILABLE'],
        'blocked Tech': ['PAYMENT_BLOCKED'],
        'fridge Tech': ['MISSING_SKILL'],
      });
    });

    it('is the same every time it is asked', async () => {
      const id = await approvedCase();
      const first = (await ranking(id).expect(200)).body;
      const second = (await ranking(id).expect(200)).body;
      expect(second.ranking).toEqual(first.ranking);
    });
  });

  // ------------------------------------------------------------------ assigning

  describe('assigning', () => {
    it('lets the dispatcher override the top recommendation and keeps the ranking snapshot', async () => {
      const id = await approvedCase();
      const when = new Date(Date.now() + 3_600_000).toISOString();

      const res = await assign(id, { technician_profile_id: profileIds.mid, scheduled_at: when, note: 'Customer prefers this technician' }).expect(201);
      expect(res.body).toMatchObject({ status: 'PENDING', is_external: false, technician_profile_id: profileIds.mid, assigned_by: ids.dispatcher });
      expect(res.body.request.status).toBe('ASSIGNED');

      const stored = await prisma.assignment.findUniqueOrThrow({ where: { id: res.body.id } });
      const snapshot = stored.ranking_snapshot as Record<string, any>;
      expect(snapshot.overridden).toBe(true);
      expect(snapshot.chosen).toMatchObject({ technicianProfileId: profileIds.mid, rank: 2, score: 60 });
      expect(snapshot.ranking).toHaveLength(2);
      expect(snapshot.weights.skill).toBe(0.3);
      expect(snapshot.dispatcher_note).toBe('Customer prefers this technician');
      expect(stored.scheduled_at?.toISOString()).toBe(when);

      const detail = await http().get(`${API}/cases/${id}`).set(as('customer')).expect(200);
      expect(detail.body.status).toBe('ASSIGNED');
      expect(detail.body.status_history.map((h: { to_status: string }) => h.to_status).slice(-1)).toEqual(['ASSIGNED']);

      expect(await prisma.auditLog.count({ where: { entity_id: res.body.id, action: AuditAction.ASSIGNMENT_CREATED } })).toBe(1);
      const techNote = await prisma.notification.findFirst({
        where: { user_id: ids.mid, request_id: id, notification_type: NotificationType.ASSIGNMENT_CREATED },
      });
      expect(techNote).not.toBeNull();
      const customerNote = await prisma.notification.findFirst({
        where: { user_id: ids.customer, request_id: id, title: 'A technician has been assigned' },
      });
      expect(customerNote?.body).toBe('AC not cooling');
    });

    it('records a top-ranked pick as not overridden', async () => {
      const id = await approvedCase();
      const res = await assign(id, { technician_profile_id: profileIds.star }).expect(201);
      const stored = await prisma.assignment.findUniqueOrThrow({ where: { id: res.body.id } });
      expect((stored.ranking_snapshot as Record<string, any>).overridden).toBe(false);
    });

    it('refuses an unapproved case, an ineligible technician, an unknown id, a past date and the wrong role', async () => {
      const fresh = await http()
        .post(`${API}/requests`)
        .set(as('customer'))
        .send({ equipment_id: equipmentId, address_id: addressId, title: 'AC', description: 'The AC is broken for days now.' })
        .expect(201);
      const early = await assign(fresh.body.id, { technician_profile_id: profileIds.star }).expect(409);
      expect(early.body.error.code).toBe('NOT_APPROVED');

      const id = await approvedCase();
      const ineligible = await assign(id, { technician_profile_id: profileIds.off }).expect(409);
      expect(ineligible.body.error).toMatchObject({ code: 'NOT_ELIGIBLE', details: { reasons: ['NOT_AVAILABLE'] } });
      expect((await assign(id, { technician_profile_id: profileIds.blocked }).expect(409)).body.error.details.reasons).toEqual(['PAYMENT_BLOCKED']);
      expect((await assign(id, { technician_profile_id: profileIds.fridge }).expect(409)).body.error.details.reasons).toEqual(['MISSING_SKILL']);
      // an applicant is not an approved technician at all
      expect((await assign(id, { technician_profile_id: profileIds.applicant }).expect(400)).body.error.code).toBe('UNKNOWN_TECHNICIAN');
      await assign(id, { technician_profile_id: '00000000-0000-4000-8000-000000000000' }).expect(400);
      await assign(id, { technician_profile_id: profileIds.star, scheduled_at: new Date(Date.now() - 86_400_000).toISOString() }).expect(400);
      await assign(id, { technician_profile_id: profileIds.star }, 'customer').expect(403);
      await assign(id, { technician_profile_id: profileIds.star }, 'star').expect(403);
      await assign(id, { technician_profile_id: profileIds.star }, 'manager').expect(403);

      // none of those attempts changed the case
      expect((await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id } })).status).toBe(RequestStatus.APPROVED);
      expect(await prisma.assignment.count({ where: { request_id: id } })).toBe(0);
    });

    it('cannot assign the same case twice, even when two dispatchers click at the same moment', async () => {
      const id = await approvedCase();
      const results = await Promise.all([
        assign(id, { technician_profile_id: profileIds.star }),
        assign(id, { technician_profile_id: profileIds.mid }),
      ]);
      const codes = results.map((r) => r.status).sort();
      expect(codes).toEqual([201, 409]);
      expect(await prisma.assignment.count({ where: { request_id: id, status: AssignmentStatus.PENDING } })).toBe(1);

      const again = await assign(id, { technician_profile_id: profileIds.star }).expect(409);
      expect(again.body.error.code).toBe('NOT_APPROVED');
    });

    it('never gives a technician more than 3 open assignments when two dispatchers assign different cases at once', async () => {
      // bring a technician to exactly 2 open assignments, then race two different cases at them
      const made: string[] = [];
      while ((await openJobs(profileIds.mid)) < 2) {
        const caseId = await approvedCase();
        made.push((await assign(caseId, { technician_profile_id: profileIds.mid }).expect(201)).body.id);
      }
      try {
        expect(await openJobs(profileIds.mid)).toBe(2);
        const [caseA, caseB] = [await approvedCase(), await approvedCase()];
        const results = await Promise.all([
          assign(caseA, { technician_profile_id: profileIds.mid }),
          assign(caseB, { technician_profile_id: profileIds.mid }),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
        expect(results.find((r) => r.status === 409)!.body.error).toMatchObject({
          code: 'NOT_ELIGIBLE',
          details: { reasons: ['TOO_MANY_ACTIVE_JOBS'] },
        });
        expect(await openJobs(profileIds.mid)).toBe(3);
        for (const r of results) if (r.status === 201) made.push(r.body.id);
      } finally {
        await release(made);
      }
    });

    it('leaves nothing behind when a step inside the assign transaction fails, and sends no notification', async () => {
      const id = await approvedCase();
      const audit = app.get(AuditService);
      const original = audit.log.bind(audit);
      const spy = jest.spyOn(audit, 'log').mockImplementation(((entry: { action: AuditAction }, tx?: never) => {
        if (entry.action === AuditAction.ASSIGNMENT_CREATED) return Promise.reject(new Error('forced failure'));
        return original(entry as never, tx);
      }) as never);
      const statusRows = await prisma.requestStatusHistory.count({ where: { request_id: id } });
      try {
        await assign(id, { technician_profile_id: profileIds.star }).expect(500);
      } finally {
        spy.mockRestore();
      }
      expect((await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id } })).status).toBe(RequestStatus.APPROVED);
      expect(await prisma.assignment.count({ where: { request_id: id } })).toBe(0);
      expect(await prisma.requestStatusHistory.count({ where: { request_id: id } })).toBe(statusRows);
      expect(await prisma.notification.count({ where: { request_id: id, notification_type: NotificationType.ASSIGNMENT_CREATED } })).toBe(0);
      // and the case can still be assigned afterwards
      const retry = await assign(id, { technician_profile_id: profileIds.star }).expect(201);
      await release([retry.body.id]);
    });

    it('lowers availability by a third for every open assignment, PENDING ones included', async () => {
      const id = await approvedCase();
      const open = await openJobs(profileIds.star);
      expect(open).toBeGreaterThan(0);
      expect(open).toBeLessThan(3);

      const res = await ranking(id).expect(200);
      const star = res.body.ranking.find((r: { name: string }) => r.name === 'star Tech');
      expect(star.factors.availability).toBe(Number((1 - open / 3).toFixed(4)));
      expect(star.contributions.availability).toBe(Number((30 * (1 - open / 3)).toFixed(2)));
    });

    it('leaves out a technician with 3 open assignments, says why, and refuses to assign them', async () => {
      const created = await fillToLimit(profileIds.star);
      try {
        const id = await approvedCase();
        const res = await ranking(id).expect(200);
        expect(res.body.ranking.map((r: { name: string }) => r.name)).not.toContain('star Tech');
        const left = res.body.excluded.find((e: { name: string }) => e.name === 'star Tech');
        expect(left.reasons).toEqual(['TOO_MANY_ACTIVE_JOBS']);

        const refused = await assign(id, { technician_profile_id: profileIds.star }).expect(409);
        expect(refused.body.error.code).toBe('NOT_ELIGIBLE');
      } finally {
        await release(created);
      }
    });

    it('leaves out a technician who already rejected this case', async () => {
      const id = await approvedCase();
      await prisma.assignment.create({
        data: {
          request_id: id,
          technician_profile_id: profileIds.star,
          assigned_by: ids.dispatcher,
          status: AssignmentStatus.REJECTED,
          rejection_reason: 'Too far away',
        },
      });
      const res = await ranking(id).expect(200);
      const left = res.body.excluded.find((e: { name: string }) => e.name === 'star Tech');
      expect(left.reasons).toEqual(['REJECTED_THIS_CASE']);
      const refused = await assign(id, { technician_profile_id: profileIds.star }).expect(409);
      expect(refused.body.error.code).toBe('NOT_ELIGIBLE');
    });
  });

  // ------------------------------------------------------------------ assignment lists

  describe('who sees which assignments', () => {
    it('shows a technician only their own, and staff everything', async () => {
      const mine = await http().get(`${API}/assignments`).set(as('mid')).expect(200);
      expect(mine.body.data.length).toBeGreaterThanOrEqual(1);
      expect(mine.body.data.every((a: { technician_profile_id: string }) => a.technician_profile_id === profileIds.mid)).toBe(true);
      expect(mine.body.data[0].request).toMatchObject({ status: expect.any(String) });
      // the technician sees the customer's first name only, never their phone
      expect(Object.keys(mine.body.data[0].request.customer)).toEqual(['first_name']);

      const none = await http().get(`${API}/assignments`).set(as('fridge')).expect(200);
      expect(none.body.data).toEqual([]);

      const all = await http().get(`${API}/assignments?pageSize=100`).set(as('dispatcher')).expect(200);
      expect(all.body.meta.total).toBeGreaterThan(mine.body.meta.total);
      await http().get(`${API}/assignments`).set(as('manager')).expect(200);
      await http().get(`${API}/assignments`).set(as('customer')).expect(403);

      const pending = await http().get(`${API}/assignments?status=PENDING&pageSize=100`).set(as('dispatcher')).expect(200);
      expect(pending.body.data.every((a: { status: string }) => a.status === 'PENDING')).toBe(true);
    });
  });

  // ------------------------------------------------------------------ availability switch

  describe('the availability switch', () => {
    it('lets a technician flip their own, a dispatcher flip anyone\'s, and nobody else', async () => {
      const off = await http().patch(`${API}/technicians/${profileIds.mid}/availability`).set(as('mid')).send({ is_available: false }).expect(200);
      expect(off.body).toEqual({ id: profileIds.mid, is_available: false });
      expect((await prisma.technicianProfile.findUniqueOrThrow({ where: { id: profileIds.mid } })).is_available).toBe(false);

      // the ranking now leaves mid out
      const id = await approvedCase();
      const res = await ranking(id).expect(200);
      expect(res.body.ranking.map((r: { name: string }) => r.name)).toEqual(['star Tech']);
      expect(res.body.excluded.find((e: { name: string }) => e.name === 'mid Tech').reasons).toEqual(['NOT_AVAILABLE']);

      await http().patch(`${API}/technicians/${profileIds.mid}/availability`).set(as('dispatcher')).send({ is_available: true }).expect(200);
      expect(await prisma.auditLog.count({ where: { entity_id: profileIds.mid, action: AuditAction.USER_UPDATED } })).toBe(2);

      // another technician's profile is a 404; customers and managers are refused; the value must be a boolean
      await http().patch(`${API}/technicians/${profileIds.mid}/availability`).set(as('star')).send({ is_available: false }).expect(404);
      await http().patch(`${API}/technicians/${profileIds.mid}/availability`).set(as('customer')).send({ is_available: false }).expect(403);
      await http().patch(`${API}/technicians/${profileIds.mid}/availability`).set(as('manager')).send({ is_available: false }).expect(403);
      await http().patch(`${API}/technicians/${profileIds.mid}/availability`).set(as('mid')).send({ is_available: 'yes' }).expect(400);
    });

    it('is not available to a technician whose application is not approved', async () => {
      const res = await http()
        .patch(`${API}/technicians/${profileIds.applicant}/availability`)
        .set(as('applicant'))
        .send({ is_available: true })
        .expect(409);
      expect(res.body.error.code).toBe('NOT_APPROVED');
    });
  });

  // ------------------------------------------------------------------ external technician

  describe('an external technician for an emergency', () => {
    it('is refused for a normal case and while an internal technician is free', async () => {
      const normal = await approvedCase();
      const wrongKind = await http()
        .post(`${API}/cases/${normal}/assignments/external`)
        .set(as('dispatcher'))
        .send({ external_name: 'Fixit Co', external_phone: '+96170123456' })
        .expect(409);
      // NOTE(plan-alignment): URGENT may use an external technician too; only a NORMAL case is refused.
      expect(wrongKind.body.error.code).toBe('EXTERNAL_NOT_ALLOWED');

      const emergency = await approvedCase(true);
      const free = await http()
        .post(`${API}/cases/${emergency}/assignments/external`)
        .set(as('dispatcher'))
        .send({ external_name: 'Fixit Co', external_phone: '+96170123456' })
        .expect(409);
      expect(free.body.error.code).toBe('INTERNAL_AVAILABLE');
    });

    it('is recorded with name and phone, no profile, when every internal technician is unavailable or busy', async () => {
      const emergency = await approvedCase(true);
      // the emergency ranking uses the emergency weights and rates
      const preview = await ranking(emergency).expect(200);
      expect(preview.body).toMatchObject({ priority: 'EMERGENCY', rateType: 'EMERGENCY' });
      expect(preview.body.weights.availability).toBe(0.4);

      await setAllAvailability(false);
      try {
        const bad = await http()
          .post(`${API}/cases/${emergency}/assignments/external`)
          .set(as('dispatcher'))
          .send({ external_name: 'Fixit Co', external_phone: 'abc' })
          .expect(400);
        expect(bad.body.error.code).toBe('VALIDATION_ERROR');
        await http().post(`${API}/cases/${emergency}/assignments/external`).set(as('customer')).send({ external_name: 'x', external_phone: '+96170123456' }).expect(403);

        const res = await http()
          .post(`${API}/cases/${emergency}/assignments/external`)
          .set(as('dispatcher'))
          .send({ external_name: 'Fixit Co', external_phone: '+96170123456', note: 'Phoned at 14:10' })
          .expect(201);
        expect(res.body).toMatchObject({
          is_external: true,
          external_name: 'Fixit Co',
          external_phone: '+96170123456',
          technician_profile_id: null,
          status: 'ACCEPTED',
        });
        expect(res.body.request.status).toBe('ASSIGNED');
        expect(await prisma.auditLog.count({ where: { entity_id: res.body.id, action: AuditAction.ASSIGNMENT_CREATED } })).toBe(1);
        // the external technician has no account and no ranking snapshot of candidates
        const stored = await prisma.assignment.findUniqueOrThrow({ where: { id: res.body.id } });
        expect(stored.accepted_at).not.toBeNull();
        expect((stored.ranking_snapshot as Record<string, any>).external).toBe(true);
      } finally {
        await setAllAvailability(true);
        await prisma.technicianProfile.updateMany({ where: { id: { in: [profileIds.off] } }, data: { is_available: false } });
      }
    });

    it('is allowed for an URGENT case once no internal technician is eligible, and refused while one is', async () => {
      const urgent = await approvedCase('URGENT');
      const external = () =>
        http()
          .post(`${API}/cases/${urgent}/assignments/external`)
          .set(as('dispatcher'))
          .send({ external_name: 'Fixit Co', external_phone: '+96170123456', note: 'Urgent, nobody free' });

      const free = await external().expect(409);
      expect(free.body.error.code).toBe('INTERNAL_AVAILABLE');

      await setAllAvailability(false);
      try {
        const res = await external().expect(201);
        expect(res.body).toMatchObject({ is_external: true, status: 'ACCEPTED', technician_profile_id: null });
        expect(res.body.request).toMatchObject({ status: 'ASSIGNED', priority: 'URGENT' });
      } finally {
        await setAllAvailability(true);
        await prisma.technicianProfile.updateMany({ where: { id: { in: [profileIds.off] } }, data: { is_available: false } });
      }
    });

    it('is also allowed when the only available technicians are all at the 3-job limit', async () => {
      const emergency = await approvedCase(true);
      await prisma.technicianProfile.updateMany({ where: { id: { in: [profileIds.mid] } }, data: { is_available: false } });
      const created = await fillToLimit(profileIds.star);
      try {
        await http()
          .post(`${API}/cases/${emergency}/assignments/external`)
          .set(as('dispatcher'))
          .send({ external_name: 'Fixit Co', external_phone: '+96170123456' })
          .expect(201);
      } finally {
        await release(created);
        await prisma.technicianProfile.update({ where: { id: profileIds.mid }, data: { is_available: true } });
      }
    });
  });

  // ------------------------------------------------------------------ cancelling an assigned case

  describe('a customer cancelling an assigned case', () => {
    it('cancels the open assignment in the same step, audits it and tells the technician', async () => {
      const id = await approvedCase();
      const created = await assign(id, { technician_profile_id: profileIds.star }).expect(201);

      await http().post(`${API}/cases/${id}/cancel`).set(as('customer')).send({ reason: 'Fixed it myself' }).expect(200);

      const assignment = await prisma.assignment.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(assignment.status).toBe(AssignmentStatus.CANCELLED);
      expect((await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id } })).status).toBe(RequestStatus.CANCELLED);
      expect(await prisma.auditLog.count({ where: { entity_id: created.body.id, action: AuditAction.ASSIGNMENT_CANCELLED } })).toBe(1);
      const note = await prisma.notification.findFirst({ where: { user_id: ids.star, request_id: id, title: 'An assignment was cancelled' } });
      expect(note).not.toBeNull();
    });
  });
});
