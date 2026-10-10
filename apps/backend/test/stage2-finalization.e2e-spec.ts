import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AssignmentStatus,
  AuditAction,
  CommissionTierName,
  MaintenanceCategory,
  NotificationType,
  ProfileStatus,
  RequestPriority,
  Role,
  TierRequestStatus,
  TierRequestType,
} from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { hashPassword } from '../src/common/password';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { CaseLifecycleService } from '../src/modules/cases/case-lifecycle.service';
import { TierRequestsService } from '../src/modules/technicians/tier-requests.service';

const API = '/api/v1';
const PASSWORD = 'e2e-password-123';

describe('Stage 2 finalization (e2e, throwaway database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const profileIds: Record<string, string> = {};
  const tierIds: Record<string, string> = {};
  let hvacSkill: string;
  let extraSkill: string;
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

  async function createTech(
    key: string,
    o: { status?: ProfileStatus; rating?: number; years?: number; reviews?: number; tier?: CommissionTierName } = {},
  ) {
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
            current_tier_id: o.tier ? tierIds[o.tier] : tierIds.BRONZE,
            years_of_experience: o.years ?? 5,
            rating: o.rating ?? 4,
            total_reviews: o.reviews ?? 10,
            normal_rate: 20,
            emergency_rate: 30,
            skills: { create: [{ skill_id: hvacSkill, proficiency_level: 4 }] },
          },
        },
      },
      include: { technician_profile: true },
    });
    ids[key] = user.id;
    profileIds[key] = user.technician_profile!.id;
    await login(key);
  }

  async function newCase(key = 'custA', extra: Record<string, unknown> = {}): Promise<string> {
    const res = await http()
      .post(`${API}/requests`)
      .set(as(key))
      .send({ equipment_id: equipmentId, address_id: addressId, title: 'AC not cooling', description: 'The AC blows warm air since yesterday.', ...extra })
      .expect(201);
    return res.body.id as string;
  }
  const review = (id: string, body: Record<string, unknown>) => http().post(`${API}/cases/${id}/review`).set(as('dispatcher')).send(body);
  async function approvedCase(): Promise<string> {
    const id = await newCase();
    await review(id, { action: 'START' }).expect(200);
    await review(id, { action: 'APPROVE' }).expect(200);
    return id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    hvacSkill = (await prisma.skill.create({ data: { name: 'AC repair', category: MaintenanceCategory.HVAC } })).id;
    extraSkill = (await prisma.skill.create({ data: { name: 'Duct cleaning', category: MaintenanceCategory.HVAC } })).id;
    typeId = (await prisma.equipmentType.create({ data: { name: 'Split air conditioner', category: MaintenanceCategory.HVAC } })).id;
    for (const [name, rate, rating, years, jobs] of [
      [CommissionTierName.BRONZE, 15, null, null, null],
      [CommissionTierName.SILVER, 12, 4, 3, 2],
      [CommissionTierName.GOLD, 10, 4.5, 6, 40],
    ] as const) {
      tierIds[name] = (
        await prisma.commissionTier.create({
          data: { name, commission_rate: rate, min_rating: rating, min_experience_years: years, min_completed_jobs: jobs },
        })
      ).id;
    }

    await createUser('custA', Role.CUSTOMER);
    await createUser('custB', Role.CUSTOMER);
    await createUser('dispatcher', Role.DISPATCHER);
    await createUser('manager', Role.MANAGER);
    await createTech('ali');
    await createTech('sara', { rating: 3, years: 1, reviews: 2 });
    await createTech('newbie', { status: ProfileStatus.PENDING_REVIEW });

    addressId = (await http().post(`${API}/addresses`).set(as('custA')).send({ street: '1 Main St', city: 'Beirut' }).expect(201)).body.id;
    equipmentId = (
      await http().post(`${API}/equipment`).set(as('custA')).send({ equipment_type_id: typeId, address_id: addressId, name: 'Living room AC' }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ------------------------------------------------------------------ 1. customer-confirmed summary and safety

  describe('customer summary and safety confirmation', () => {
    let caseId: string;

    beforeAll(async () => {
      caseId = await newCase('custA', { intake_answers: { safety_concern: false, symptoms: ['warm air'] }, problem_type: 'NOT_COOLING' });
      await review(caseId, { action: 'START' }).expect(200);
      // the dispatcher records AI-style fields that the customer must never see
      await http()
        .patch(`${API}/cases/${caseId}`)
        .set(as('dispatcher'))
        .send({ summary: 'AC blows warm air', urgency_level: 'MEDIUM', possible_causes: ['gas leak in the compressor', 'failed capacitor'], symptoms: ['warm air', 'noise'] })
        .expect(200);
    });

    it('shows the customer their own summary, and never possible causes or urgency', async () => {
      const res = await http().get(`${API}/requests/${caseId}/summary`).set(as('custA')).expect(200);
      expect(res.body).toMatchObject({
        request_id: caseId,
        source: 'CASE',
        device: { name: 'Living room AC', type: 'Split air conditioner' },
        problem: { title: 'AC not cooling', description: 'AC blows warm air' },
        symptoms: ['warm air', 'noise'],
        safety: { answer: 'NO', escalated: false },
        confirmation: { status: 'NOT_CONFIRMED' },
      });
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/possible_causes|gas leak|capacitor|urgency|MEDIUM/);
    });

    it('only the owning customer can read or answer it (404 for others), and dispatchers have no customer route', async () => {
      await http().get(`${API}/requests/${caseId}/summary`).set(as('custB')).expect(404);
      await http().post(`${API}/requests/${caseId}/summary/confirm`).set(as('custB')).send({ confirmed: true }).expect(404);
      await http().get(`${API}/requests/${caseId}/summary`).set(as('dispatcher')).expect(403);
      await http().post(`${API}/requests/${caseId}/summary/confirm`).set(as('dispatcher')).send({ confirmed: true }).expect(403);
      const row = await prisma.maintenanceCase.findUniqueOrThrow({ where: { request_id: caseId } });
      expect(row.customer_confirmed_at).toBeNull();
    });

    it('the dispatcher sees Not confirmed yet, then Customer confirmed, then Customer corrected with the note', async () => {
      const view = () => http().get(`${API}/cases/${caseId}`).set(as('dispatcher')).expect(200);
      expect((await view()).body.customer_confirmation).toMatchObject({ status: 'NOT_CONFIRMED', note: null });

      const confirmed = await http().post(`${API}/requests/${caseId}/summary/confirm`).set(as('custA')).send({ confirmed: true }).expect(200);
      expect(confirmed.body.confirmation.status).toBe('CONFIRMED');
      expect((await view()).body.customer_confirmation).toMatchObject({ status: 'CONFIRMED', note: null });

      await http().post(`${API}/requests/${caseId}/summary/confirm`).set(as('custA')).send({ confirmed: false, note: 'It is the bedroom unit, not the living room.' }).expect(200);
      expect((await view()).body.customer_confirmation).toMatchObject({ status: 'CORRECTED', note: 'It is the bedroom unit, not the living room.' });

      const audits = await prisma.auditLog.count({ where: { action: AuditAction.CASE_CONFIRMED_BY_CUSTOMER, user_id: ids.custA } });
      expect(audits).toBe(2);
    });

    it('validates the answer: a correction needs a note, a confirmation cannot carry one', async () => {
      await http().post(`${API}/requests/${caseId}/summary/confirm`).set(as('custA')).send({ confirmed: false }).expect(400);
      await http().post(`${API}/requests/${caseId}/summary/confirm`).set(as('custA')).send({ confirmed: true, note: 'x' }).expect(400);
      await http().post(`${API}/requests/${caseId}/summary/confirm`).set(as('custA')).send({}).expect(400);
    });

    it('never lowers urgency or removes a safety flag', async () => {
      await http().patch(`${API}/cases/${caseId}`).set(as('dispatcher')).send({ urgency_level: 'HIGH' }).expect(200);
      await http().post(`${API}/requests/${caseId}/summary/confirm`).set(as('custA')).send({ confirmed: true }).expect(200);
      await http().post(`${API}/requests/${caseId}/summary/confirm`).set(as('custA')).send({ confirmed: false, note: 'Actually it is not that serious.' }).expect(200);

      const row = await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id: caseId }, include: { case: true } });
      expect(row.case!.urgency_level).toBe('HIGH');
      expect(row.is_safety_escalated).toBe(true);
    });

    it('a danger keyword in the correction returns the fixed question but does NOT escalate by itself', async () => {
      const id = await newCase('custA');
      const res = await http()
        .post(`${API}/requests/${id}/summary/confirm`)
        .set(as('custA'))
        .send({ confirmed: false, note: 'By the way it smells like gas near the unit' })
        .expect(200);
      expect(res.body.safety_check).toEqual({ categories: ['GAS'], question: 'Can you smell gas right now?' });

      const row = await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id } });
      expect(row.is_safety_escalated).toBe(false);
      expect(row.priority).toBe(RequestPriority.NORMAL);
      expect(await prisma.auditLog.count({ where: { entity_id: id, action: AuditAction.SAFETY_ESCALATED } })).toBe(0);
    });

    it('builds the summary from the form when there is no case record', async () => {
      const id = await newCase('custA', { intake_answers: { symptoms: ['strange smell'], safety_concern: true } });
      await prisma.maintenanceCase.delete({ where: { request_id: id } });
      const res = await http().get(`${API}/requests/${id}/summary`).set(as('custA')).expect(200);
      expect(res.body).toMatchObject({ source: 'FORM', symptoms: ['strange smell'], safety: { answer: 'YES' } });
      await http().post(`${API}/requests/${id}/summary/confirm`).set(as('custA')).send({ confirmed: true }).expect(404);
    });

    it('refuses to answer the summary of a closed case', async () => {
      const id = await newCase('custA');
      await review(id, { action: 'REJECT', reason: 'Not something we repair' }).expect(200);
      const res = await http().post(`${API}/requests/${id}/summary/confirm`).set(as('custA')).send({ confirmed: true }).expect(409);
      expect(res.body.error.code).toBe('CASE_CLOSED');
    });

    it('safety-confirm: "no" does nothing, a clear "yes" escalates and notifies the dispatchers', async () => {
      const id = await newCase('custA');

      const no = await http().post(`${API}/requests/${id}/safety-confirm`).set(as('custA')).send({ answer: 'no' }).expect(200);
      expect(no.body).toMatchObject({ escalated: false, changed: false, priority: RequestPriority.NORMAL });
      expect((await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id } })).is_safety_escalated).toBe(false);
      expect(await prisma.notification.count({ where: { request_id: id, notification_type: NotificationType.SAFETY_ESCALATED } })).toBe(0);

      const yes = await http().post(`${API}/requests/${id}/safety-confirm`).set(as('custA')).send({ answer: 'yes' }).expect(200);
      expect(yes.body).toMatchObject({ escalated: true, changed: true, priority: RequestPriority.EMERGENCY });
      const row = await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ priority: RequestPriority.EMERGENCY, is_safety_escalated: true });
      expect(row.escalated_at).not.toBeNull();
      expect(await prisma.auditLog.count({ where: { entity_id: id, action: AuditAction.SAFETY_ESCALATED } })).toBe(1);
      const note = await prisma.notification.findFirst({ where: { request_id: id, user_id: ids.dispatcher, notification_type: NotificationType.SAFETY_ESCALATED } });
      expect(note?.priority).toBe('URGENT');

      // answering yes again is harmless: no second audit row, no second notification
      const again = await http().post(`${API}/requests/${id}/safety-confirm`).set(as('custA')).send({ answer: 'yes' }).expect(200);
      expect(again.body.changed).toBe(false);
      expect(await prisma.auditLog.count({ where: { entity_id: id, action: AuditAction.SAFETY_ESCALATED } })).toBe(1);
      expect(await prisma.notification.count({ where: { request_id: id, notification_type: NotificationType.SAFETY_ESCALATED } })).toBe(1);
    });

    it('safety-confirm: other customers get 404, other roles 403, and bad answers 400', async () => {
      const id = await newCase('custA');
      await http().post(`${API}/requests/${id}/safety-confirm`).set(as('custB')).send({ answer: 'yes' }).expect(404);
      await http().post(`${API}/requests/${id}/safety-confirm`).set(as('dispatcher')).send({ answer: 'yes' }).expect(403);
      await http().post(`${API}/requests/${id}/safety-confirm`).set(as('custA')).send({ answer: 'maybe' }).expect(400);
      expect((await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id } })).is_safety_escalated).toBe(false);
    });
  });

  // ------------------------------------------------------------------ 2. CASE_UPDATED audit in the same transaction

  describe('dispatcher case edits are audited (CASE_UPDATED)', () => {
    it('writes a CASE_UPDATED row with the old and new values', async () => {
      const id = await newCase('custA');
      await review(id, { action: 'START' }).expect(200);
      const caseRow = await prisma.maintenanceCase.findUniqueOrThrow({ where: { request_id: id } });

      await http().patch(`${API}/cases/${id}`).set(as('dispatcher')).send({ summary: 'Edited by the dispatcher', problem_type: 'NOT_COOLING' }).expect(200);

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entity_id: caseRow.id, action: AuditAction.CASE_UPDATED } });
      expect(audit.user_id).toBe(ids.dispatcher);
      expect(audit.old_value).toMatchObject({ summary: caseRow.summary, problem_type: null });
      expect(audit.new_value).toEqual({ summary: 'Edited by the dispatcher', problem_type: 'NOT_COOLING' });
    });

    it('rolls back BOTH the edit and its audit row when something fails after the audit call', async () => {
      const id = await newCase('custA');
      await review(id, { action: 'START' }).expect(200);
      const before = await prisma.maintenanceCase.findUniqueOrThrow({ where: { request_id: id } });
      const auditCount = () => prisma.auditLog.count({ where: { entity_id: before.id, action: AuditAction.CASE_UPDATED } });
      expect(await auditCount()).toBe(0);

      // The escalation for HIGH urgency runs after the audit call. Make it fail.
      const spy = jest.spyOn(app.get(CaseLifecycleService), 'escalate').mockRejectedValueOnce(new Error('forced failure after the audit call'));
      try {
        await http().patch(`${API}/cases/${id}`).set(as('dispatcher')).send({ summary: 'Must not stick', urgency_level: 'HIGH' }).expect(500);
      } finally {
        spy.mockRestore();
      }

      const after = await prisma.maintenanceCase.findUniqueOrThrow({ where: { request_id: id } });
      expect(after.summary).toBe(before.summary);
      expect(after.urgency_level).toBe(before.urgency_level);
      expect(await auditCount()).toBe(0);
    });
  });

  // ------------------------------------------------------------------ 3. technician tier requests

  describe('tier requests', () => {
    let skillsRequest: string;
    let tierRequest: string;

    it('lets an approved technician ask for a review with new skills, once at a time', async () => {
      const res = await http().post(`${API}/technicians/me/tier-requests`).set(as('ali')).send({ notes: 'I finished duct cleaning training', skillIds: [extraSkill] }).expect(201);
      expect(res.body.status).toBe('PENDING');
      skillsRequest = res.body.id;

      const again = await http().post(`${API}/technicians/me/tier-requests`).set(as('ali')).send({ notes: 'Another one please' }).expect(409);
      expect(again.body.error.code).toBe('REQUEST_PENDING');

      const note = await prisma.notification.findFirst({ where: { user_id: ids.manager, notification_type: NotificationType.SYSTEM } });
      expect(note?.title).toBe('Tier update request');
    });

    it('refuses an applicant, a dispatcher and a customer', async () => {
      const applicant = await http().post(`${API}/technicians/me/tier-requests`).set(as('newbie')).send({ notes: 'Please review me' }).expect(409);
      expect(applicant.body.error.code).toBe('NOT_APPROVED');
      await http().post(`${API}/technicians/me/tier-requests`).set(as('dispatcher')).send({ notes: 'Please review me' }).expect(403);
      await http().post(`${API}/technicians/me/tier-requests`).set(as('custA')).send({ notes: 'Please review me' }).expect(403);
      await http().post(`${API}/technicians/me/tier-requests`).set(as('ali')).send({ skillIds: [] }).expect(400);
    });

    it('is a manager-only list, and a dispatcher or technician gets 403 on every manager route', async () => {
      const list = await http().get(`${API}/manager/tier-requests`).set(as('manager')).expect(200);
      expect(list.body.meta.total).toBe(1);
      expect(list.body.data[0]).toMatchObject({ id: skillsRequest, notes: 'I finished duct cleaning training', status: 'PENDING' });
      expect(list.body.data[0].requested_skills[0]).toMatchObject({ id: extraSkill, name: 'Duct cleaning' });

      for (const who of ['dispatcher', 'ali', 'custA']) {
        await http().get(`${API}/manager/tier-requests`).set(as(who)).expect(403);
        await http().post(`${API}/tier-requests/${skillsRequest}/decide`).set(as(who)).send({ outcome: 'SKILLS_NOTED_ONLY' }).expect(403);
        await http().patch(`${API}/technicians/${profileIds.ali}/rates`).set(as(who)).send({ normal_rate: 25, emergency_rate: 35 }).expect(403);
        await http().put(`${API}/technicians/${profileIds.ali}/skills`).set(as(who)).send({ skills: [{ skill_id: hvacSkill, proficiency_level: 3 }] }).expect(403);
        await http().post(`${API}/skills`).set(as(who)).send({ name: 'Not allowed', category: 'HVAC' }).expect(403);
        await http().post(`${API}/teams`).set(as(who)).send({ name: 'Not allowed', category: 'HVAC' }).expect(403);
      }
    });

    it('SKILLS_NOTED_ONLY adds the skill and leaves the tier and commission alone', async () => {
      const res = await http().post(`${API}/tier-requests/${skillsRequest}/decide`).set(as('manager')).send({ outcome: 'SKILLS_NOTED_ONLY', notes: 'Certificate checked' }).expect(200);
      expect(res.body).toMatchObject({ status: 'APPROVED', decision_outcome: 'SKILLS_NOTED_ONLY', reviewed_by: ids.manager });

      const profile = await prisma.technicianProfile.findUniqueOrThrow({ where: { id: profileIds.ali }, include: { skills: true } });
      expect(profile.current_tier_id).toBe(tierIds.BRONZE);
      expect(profile.skills.map((s) => [s.skill_id, s.proficiency_level]).sort()).toEqual(
        [[extraSkill, 1], [hvacSkill, 4]].sort(),
      );
      const note = await prisma.notification.findFirst({ where: { user_id: ids.ali, title: 'Your new skills were added' } });
      expect(note).not.toBeNull();

      const again = await http().post(`${API}/tier-requests/${skillsRequest}/decide`).set(as('manager')).send({ outcome: 'NO_CHANGE', notes: 'x' }).expect(409);
      expect(again.body.error.code).toBe('ALREADY_DECIDED');
    });

    it('TIER_CHANGED updates the tier, audits TIER_CHANGED and notifies the technician', async () => {
      const created = await http().post(`${API}/technicians/me/tier-requests`).set(as('ali')).send({ notes: 'Rating and jobs are up, please review my tier' }).expect(201);
      tierRequest = created.body.id;

      await http().post(`${API}/tier-requests/${tierRequest}/decide`).set(as('manager')).send({ outcome: 'TIER_CHANGED' }).expect(400); // no tier chosen, none proposed
      const res = await http().post(`${API}/tier-requests/${tierRequest}/decide`).set(as('manager')).send({ outcome: 'TIER_CHANGED', finalTierId: tierIds.SILVER, notes: 'Well deserved' }).expect(200);
      expect(res.body).toMatchObject({ status: 'APPROVED', decision_outcome: 'TIER_CHANGED', final_tier_id: tierIds.SILVER });

      const profile = await prisma.technicianProfile.findUniqueOrThrow({ where: { id: profileIds.ali } });
      expect(profile.current_tier_id).toBe(tierIds.SILVER);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entity_id: profileIds.ali, action: AuditAction.TIER_CHANGED } });
      expect(audit.user_id).toBe(ids.manager);
      expect(audit.old_value).toEqual({ current_tier_id: tierIds.BRONZE });
      const note = await prisma.notification.findFirst({ where: { user_id: ids.ali, notification_type: NotificationType.TIER_CHANGED } });
      expect(note?.title).toBe('Your tier is now SILVER');
    });

    it('NO_CHANGE needs a reason and closes the request; an unknown tier is refused', async () => {
      const created = await http().post(`${API}/technicians/me/tier-requests`).set(as('sara')).send({ notes: 'Please look at my tier' }).expect(201);
      await http().post(`${API}/tier-requests/${created.body.id}/decide`).set(as('manager')).send({ outcome: 'NO_CHANGE' }).expect(400);
      await http().post(`${API}/tier-requests/${created.body.id}/decide`).set(as('manager')).send({ outcome: 'TIER_CHANGED', finalTierId: '00000000-0000-4000-8000-000000000000' }).expect(400);
      const res = await http().post(`${API}/tier-requests/${created.body.id}/decide`).set(as('manager')).send({ outcome: 'NO_CHANGE', notes: 'Not enough jobs yet' }).expect(200);
      expect(res.body).toMatchObject({ status: 'REJECTED', decision_outcome: 'NO_CHANGE', review_notes: 'Not enough jobs yet' });
      expect((await prisma.technicianProfile.findUniqueOrThrow({ where: { id: profileIds.sara } })).current_tier_id).toBe(tierIds.BRONZE);
    });

    it('an initial application is not a tier request', async () => {
      const application = await prisma.technicianTierRequest.create({
        data: { technician_profile_id: profileIds.newbie, request_type: TierRequestType.INITIAL_APPLICATION },
      });
      const res = await http().post(`${API}/tier-requests/${application.id}/decide`).set(as('manager')).send({ outcome: 'NO_CHANGE', notes: 'x' }).expect(400);
      expect(res.body.error.code).toBe('NOT_A_TIER_UPDATE');
    });
  });

  // ------------------------------------------------------------------ 4. rates

  describe('rates', () => {
    it('is manager-only, validated, audited, and the ranking uses the new rate', async () => {
      await http().patch(`${API}/technicians/${profileIds.ali}/rates`).set(as('ali')).send({ normal_rate: 1, emergency_rate: 2 }).expect(403);
      await http().patch(`${API}/technicians/${profileIds.ali}/rates`).set(as('manager')).send({ normal_rate: 0, emergency_rate: 30 }).expect(400);
      await http().patch(`${API}/technicians/${profileIds.ali}/rates`).set(as('manager')).send({ normal_rate: 20.555, emergency_rate: 30 }).expect(400);
      const invalid = await http().patch(`${API}/technicians/${profileIds.ali}/rates`).set(as('manager')).send({ normal_rate: 40, emergency_rate: 30 }).expect(400);
      expect(invalid.body.error.code).toBe('INVALID_RATES');
      await http().patch(`${API}/technicians/00000000-0000-4000-8000-000000000000/rates`).set(as('manager')).send({ normal_rate: 20, emergency_rate: 30 }).expect(404);

      const id = await approvedCase();
      const before = await http().get(`${API}/cases/${id}/technician-ranking`).set(as('dispatcher')).expect(200);
      expect(before.body.ranking.find((r: { name: string }) => r.name === 'ali Tech').rateUsed).toBe(20);

      const res = await http().patch(`${API}/technicians/${profileIds.ali}/rates`).set(as('manager')).send({ normal_rate: 27.5, emergency_rate: 41.25 }).expect(200);
      expect(Number(res.body.normal_rate)).toBe(27.5);

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entity_id: profileIds.ali, action: AuditAction.USER_UPDATED, user_id: ids.manager, new_value: { path: ['normal_rate'], equals: '27.5' } } });
      expect(audit.old_value).toEqual({ normal_rate: '20', emergency_rate: '30' });
      expect(audit.new_value).toEqual({ normal_rate: '27.5', emergency_rate: '41.25' });

      const after = await http().get(`${API}/cases/${id}/technician-ranking`).set(as('dispatcher')).expect(200);
      expect(after.body.ranking.find((r: { name: string }) => r.name === 'ali Tech').rateUsed).toBe(27.5);
    });
  });

  // ------------------------------------------------------------------ 5. weekly schedule

  describe('weekly schedule', () => {
    const valid = { mon: [{ from: '08:00', to: '17:00' }], sat: [{ from: '09:00', to: '13:00' }] };

    it('returns 422 with every problem for an invalid schedule, and stores a valid one', async () => {
      const bad = await http()
        .put(`${API}/technicians/${profileIds.ali}/schedule`)
        .set(as('ali'))
        .send({ schedule: { monday: [], tue: [{ from: '17:00', to: '08:00' }] } })
        .expect(422);
      expect(bad.body.error.code).toBe('INVALID_SCHEDULE');
      expect(bad.body.error.details).toHaveLength(2);
      expect((await prisma.technicianProfile.findUniqueOrThrow({ where: { id: profileIds.ali } })).weekly_schedule).toBeNull();

      const ok = await http().put(`${API}/technicians/${profileIds.ali}/schedule`).set(as('ali')).send({ schedule: valid }).expect(200);
      expect(ok.body.weekly_schedule).toEqual(valid);
      expect((await prisma.technicianProfile.findUniqueOrThrow({ where: { id: profileIds.ali } })).weekly_schedule).toEqual(valid);
    });

    it('lets a manager set anyone\'s, hides other technicians\' profiles (404), and refuses other roles and a missing field', async () => {
      await http().put(`${API}/technicians/${profileIds.sara}/schedule`).set(as('manager')).send({ schedule: valid }).expect(200);
      await http().put(`${API}/technicians/${profileIds.sara}/schedule`).set(as('ali')).send({ schedule: valid }).expect(404);
      await http().put(`${API}/technicians/${profileIds.ali}/schedule`).set(as('dispatcher')).send({ schedule: valid }).expect(403);
      await http().put(`${API}/technicians/${profileIds.ali}/schedule`).set(as('custA')).send({ schedule: valid }).expect(403);
      await http().put(`${API}/technicians/${profileIds.ali}/schedule`).set(as('ali')).send({}).expect(400);
    });

    it('clears the schedule with null, and the ranking is unchanged by it', async () => {
      const id = await approvedCase();
      const withSchedule = await http().get(`${API}/cases/${id}/technician-ranking`).set(as('dispatcher')).expect(200);
      const res = await http().put(`${API}/technicians/${profileIds.ali}/schedule`).set(as('ali')).send({ schedule: null }).expect(200);
      expect(res.body.weekly_schedule).toBeNull();
      expect((await prisma.technicianProfile.findUniqueOrThrow({ where: { id: profileIds.ali } })).weekly_schedule).toBeNull();
      const cleared = await http().get(`${API}/cases/${id}/technician-ranking`).set(as('dispatcher')).expect(200);
      expect(cleared.body.ranking).toEqual(withSchedule.body.ranking);
    });
  });

  // ------------------------------------------------------------------ skills and teams

  describe('skills and teams (manager)', () => {
    it('creates a skill (duplicate name is a 409), and edits a technician\'s skills directly', async () => {
      const created = await http().post(`${API}/skills`).set(as('manager')).send({ name: 'Dishwasher repair', category: 'HOME_APPLIANCES', description: 'Built-in units' }).expect(201);
      expect(created.body).toMatchObject({ name: 'Dishwasher repair', category: 'HOME_APPLIANCES' });
      const dup = await http().post(`${API}/skills`).set(as('manager')).send({ name: 'Dishwasher repair', category: 'HOME_APPLIANCES' }).expect(409);
      expect(dup.body.error.code).toBe('SKILL_EXISTS');
      const listed = await http().get(`${API}/skills`).expect(200);
      expect(listed.body.map((s: { name: string }) => s.name)).toContain('Dishwasher repair');

      await http().put(`${API}/technicians/${profileIds.ali}/skills`).set(as('manager')).send({ skills: [{ skill_id: hvacSkill, proficiency_level: 5 }, { skill_id: created.body.id, proficiency_level: 3 }] }).expect(200);
      const skills = await prisma.technicianSkill.findMany({ where: { technician_profile_id: profileIds.ali } });
      expect(skills.map((s) => [s.skill_id, s.proficiency_level]).sort()).toEqual([[created.body.id, 3], [hvacSkill, 5]].sort());
      await http().put(`${API}/technicians/${profileIds.ali}/skills`).set(as('manager')).send({ skills: [] }).expect(400);
      await http().put(`${API}/technicians/${profileIds.ali}/skills`).set(as('manager')).send({ skills: [{ skill_id: '00000000-0000-4000-8000-000000000000', proficiency_level: 3 }] }).expect(400);
    });

    it('creates a team and adds approved technicians only, once', async () => {
      const team = await http().post(`${API}/teams`).set(as('manager')).send({ name: 'Beirut HVAC', category: 'HVAC' }).expect(201);
      await http().post(`${API}/teams/${team.body.id}/members`).set(as('manager')).send({ user_id: ids.ali, role_in_team: 'Lead' }).expect(201);
      const dup = await http().post(`${API}/teams/${team.body.id}/members`).set(as('manager')).send({ user_id: ids.ali }).expect(409);
      expect(dup.body.error.code).toBe('ALREADY_MEMBER');
      const pending = await http().post(`${API}/teams/${team.body.id}/members`).set(as('manager')).send({ user_id: ids.newbie }).expect(409);
      expect(pending.body.error.code).toBe('NOT_APPROVED');
      await http().post(`${API}/teams/${team.body.id}/members`).set(as('manager')).send({ user_id: ids.custA }).expect(404);
      await http().post(`${API}/teams/00000000-0000-4000-8000-000000000000/members`).set(as('manager')).send({ user_id: ids.ali }).expect(404);
    });
  });

  // ------------------------------------------------------------------ nightly tier suggestion

  describe('the nightly tier suggestion', () => {
    it('proposes the next tier for a technician who meets every threshold, and only proposes', async () => {
      // SILVER needs rating >= 4, 3 years and 2 completed jobs. Make sara qualify except for jobs, then give her two.
      await prisma.technicianProfile.update({ where: { id: profileIds.sara }, data: { rating: 4.2, years_of_experience: 4, total_reviews: 12 } });
      await prisma.technicianProfile.update({ where: { id: profileIds.ali }, data: { current_tier_id: tierIds.GOLD } }); // top tier: nothing to suggest
      const service = app.get(TierRequestsService);

      expect(await service.suggestTierUpdates()).toEqual({ proposed: 0 }); // no completed jobs yet

      for (let i = 0; i < 2; i++) {
        const id = await approvedCase();
        const assigned = await http().post(`${API}/cases/${id}/assignments`).set(as('dispatcher')).send({ technician_profile_id: profileIds.sara }).expect(201);
        await prisma.assignment.update({ where: { id: assigned.body.id }, data: { status: AssignmentStatus.COMPLETED } });
      }

      expect(await service.suggestTierUpdates()).toEqual({ proposed: 1 });
      const proposal = await prisma.technicianTierRequest.findFirstOrThrow({
        where: { technician_profile_id: profileIds.sara, status: TierRequestStatus.PENDING, request_type: TierRequestType.TIER_UPDATE },
      });
      expect(proposal.proposed_tier_id).toBe(tierIds.SILVER);
      expect(JSON.parse(proposal.supporting_notes!)).toMatchObject({ suggested: true });
      // propose only: the tier did not change
      expect((await prisma.technicianProfile.findUniqueOrThrow({ where: { id: profileIds.sara } })).current_tier_id).toBe(tierIds.BRONZE);
      expect(await prisma.notification.count({ where: { user_id: ids.manager, title: 'Tier suggestions' } })).toBe(1);

      // it does not propose the same thing again while the request waits
      expect(await service.suggestTierUpdates()).toEqual({ proposed: 0 });

      // the manager sees it, marked as a suggestion
      const list = await http().get(`${API}/manager/tier-requests?status=PENDING`).set(as('manager')).expect(200);
      expect(list.body.data.find((r: { id: string }) => r.id === proposal.id)).toMatchObject({ suggested: true });
    });
  });
});

