import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditAction, MaintenanceCategory, NotificationType, RequestPriority, RequestStatus, Role } from '@prisma/client';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { hashPassword } from '../src/common/password';
import { PrismaService } from '../src/infra/prisma/prisma.service';

const API = '/api/v1';
const PASSWORD = 'e2e-password-123';

describe('Stage 2: manual customer-to-dispatcher case workflow (e2e, throwaway database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let typeId: string;

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
    const res = await http().post(`${API}/auth/login`).send({ email: `${key.toLowerCase()}@test.dev`, password: PASSWORD }).expect(200);
    tokens[key] = res.body.accessToken;
  }

  const as = (key: string) => ({ Authorization: `Bearer ${tokens[key]}` });

  async function address(key: string, body: Record<string, unknown> = {}) {
    const res = await http()
      .post(`${API}/addresses`)
      .set(as(key))
      .send({ street: '1 Main St', city: 'Beirut', ...body })
      .expect(201);
    return res.body as { id: string; is_default: boolean };
  }

  async function equipment(key: string, addressId: string, name = 'Living room AC') {
    const res = await http()
      .post(`${API}/equipment`)
      .set(as(key))
      .send({ equipment_type_id: typeId, address_id: addressId, name, brand: 'Acme' })
      .expect(201);
    return res.body as { id: string };
  }

  const newCase = async (key: string, equipmentId: string, addressId: string, extra: Record<string, unknown> = {}) =>
    (
      await http()
        .post(`${API}/requests`)
        .set(as(key))
        .send({ equipment_id: equipmentId, address_id: addressId, title: 'AC not cooling', description: 'The AC blows warm air since yesterday.', ...extra })
        .expect(201)
    ).body as { id: string };

  const review = (id: string, body: Record<string, unknown>) =>
    http().post(`${API}/cases/${id}/review`).set(as('dispatcher')).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const type = await prisma.equipmentType.create({ data: { name: 'Split air conditioner', category: MaintenanceCategory.HVAC } });
    typeId = type.id;
    await createUser('custA', Role.CUSTOMER);
    await createUser('custB', Role.CUSTOMER);
    await createUser('dispatcher', Role.DISPATCHER);
    await createUser('manager', Role.MANAGER);
    await createUser('tech', Role.TECHNICIAN);
  });

  afterAll(async () => {
    await app.close();
  });

  // ------------------------------------------------------------------ addresses and equipment

  describe('addresses and equipment', () => {
    it('makes the first address the default and lets the customer move the default', async () => {
      const first = await address('custA', { label: 'Home' });
      expect(first.is_default).toBe(true);
      const second = await address('custA', { label: 'Office' });
      expect(second.is_default).toBe(false);

      await http().patch(`${API}/addresses/${second.id}`).set(as('custA')).send({ is_default: true }).expect(200);
      const list = await http().get(`${API}/addresses`).set(as('custA')).expect(200);
      expect(list.body.filter((a: { is_default: boolean }) => a.is_default)).toHaveLength(1);
      expect(list.body[0].id).toBe(second.id);
      await http().patch(`${API}/addresses/${second.id}`).set(as('custA')).send({ is_default: false }).expect(400);
    });

    it('keeps addresses and equipment private to their owner and customer-only', async () => {
      const mine = await address('custB');
      const eq = await equipment('custB', mine.id);

      await http().patch(`${API}/addresses/${mine.id}`).set(as('custA')).send({ label: 'hijack' }).expect(404);
      await http().get(`${API}/equipment/${eq.id}`).set(as('custA')).expect(404);
      await http().patch(`${API}/equipment/${eq.id}`).set(as('custA')).send({ name: 'x' }).expect(404);
      // someone else's address cannot be attached to my equipment
      await http()
        .post(`${API}/equipment`)
        .set(as('custA'))
        .send({ equipment_type_id: typeId, address_id: mine.id, name: 'Sneaky' })
        .expect(404);
      await http().post(`${API}/addresses`).set(as('dispatcher')).send({ street: 's', city: 'c' }).expect(403);
      await http().get(`${API}/equipment`).set(as('tech')).expect(403);
    });

    it('lists equipment types for any signed-in user and rejects an unknown type', async () => {
      const types = await http().get(`${API}/equipment-types?category=HVAC`).set(as('tech')).expect(200);
      expect(types.body.map((t: { id: string }) => t.id)).toContain(typeId);
      await http().get(`${API}/equipment-types`).expect(401);
      await http()
        .post(`${API}/equipment`)
        .set(as('custA'))
        .send({ equipment_type_id: '00000000-0000-4000-8000-000000000000', name: 'x' })
        .expect(400);
    });
  });

  // ------------------------------------------------------------------ submission

  describe('submitting a manual request', () => {
    it('creates a NEW case with a MANUAL case record, a history row, and notifies dispatchers', async () => {
      const addr = await address('custA', { label: 'Flat' });
      const eq = await equipment('custA', addr.id);
      const created = await http()
        .post(`${API}/requests`)
        .set(as('custA'))
        .send({ equipment_id: eq.id, address_id: addr.id, title: 'AC not cooling', description: 'The AC blows warm air since yesterday.', priority: 'URGENT' })
        .expect(201);

      expect(created.body).toMatchObject({ status: RequestStatus.NEW, priority: 'URGENT', ai_analysis_status: 'SKIPPED', is_safety_escalated: false });
      expect(created.body.case).toMatchObject({ source: 'MANUAL' });

      const detail = await http().get(`${API}/cases/${created.body.id}`).set(as('custA')).expect(200);
      expect(detail.body.status_history).toHaveLength(1);
      expect(detail.body.status_history[0]).toMatchObject({ from_status: null, to_status: 'NEW', changed_by: ids.custA });

      const note = await prisma.notification.findFirst({
        where: { user_id: ids.dispatcher, request_id: created.body.id, notification_type: NotificationType.REQUEST_SUBMITTED },
      });
      expect(note).not.toBeNull();
      expect(await prisma.auditLog.count({ where: { entity_id: created.body.id, action: AuditAction.REQUEST_CREATED } })).toBe(1);
    });

    it('rejects bad input, other customers\' equipment/address, and the EMERGENCY priority on the detailed form', async () => {
      const addrA = await address('custA');
      const eqA = await equipment('custA', addrA.id);
      const addrB = await address('custB');
      const eqB = await equipment('custB', addrB.id);
      const base = { title: 'AC', description: 'The AC is broken for days now.' };
      const post = (body: object) => http().post(`${API}/requests`).set(as('custA')).send(body);

      await post({ ...base, equipment_id: eqA.id, address_id: addrA.id, description: 'short' }).expect(400);
      await post({ ...base, equipment_id: eqA.id, address_id: addrA.id, priority: 'EMERGENCY' }).expect(400);
      await post({ ...base, equipment_id: eqB.id, address_id: addrA.id }).expect(404);
      await post({ ...base, equipment_id: eqA.id, address_id: addrB.id }).expect(404);
      await http().post(`${API}/requests`).set(as('dispatcher')).send({ ...base, equipment_id: eqA.id, address_id: addrA.id }).expect(403);
    });

    it('escalates when the customer answers Yes to the safety question (and not otherwise)', async () => {
      const addr = await address('custA');
      const eq = await equipment('custA', addr.id);
      const plain = await newCase('custA', eq.id, addr.id, { intake_answers: { safety_concern: false } });
      expect((await http().get(`${API}/cases/${plain.id}`).set(as('custA'))).body.is_safety_escalated).toBe(false);

      const unsafe = await newCase('custA', eq.id, addr.id, { intake_answers: { safety_concern: true } });
      const detail = await http().get(`${API}/cases/${unsafe.id}`).set(as('dispatcher')).expect(200);
      expect(detail.body.is_safety_escalated).toBe(true);
      const note = await prisma.notification.findFirst({
        where: { user_id: ids.dispatcher, request_id: unsafe.id, notification_type: NotificationType.SAFETY_ESCALATED },
      });
      expect(note?.priority).toBe('URGENT');
    });
  });

  // ------------------------------------------------------------------ visibility

  describe('who can see a case', () => {
    it('shows customers only their own cases and staff the whole queue', async () => {
      const addr = await address('custB');
      const eq = await equipment('custB', addr.id);
      const mine = await newCase('custB', eq.id, addr.id);

      await http().get(`${API}/cases/${mine.id}`).set(as('custA')).expect(404);
      await http().get(`${API}/cases/${mine.id}`).set(as('tech')).expect(403);

      const listB = await http().get(`${API}/cases?pageSize=100`).set(as('custB')).expect(200);
      const idsB = listB.body.data.map((c: { id: string }) => c.id);
      expect(idsB).toContain(mine.id);

      const listA = await http().get(`${API}/cases?pageSize=100`).set(as('custA')).expect(200);
      expect(listA.body.data.map((c: { id: string }) => c.id)).not.toContain(mine.id);

      const queue = await http().get(`${API}/cases?pageSize=100&status=NEW`).set(as('dispatcher')).expect(200);
      expect(queue.body.data.map((c: { id: string }) => c.id)).toContain(mine.id);
      await http().get(`${API}/cases`).set(as('manager')).expect(200);
    });
  });

  // ------------------------------------------------------------------ dispatcher workflow

  describe('dispatcher review workflow', () => {
    it('walks NEW -> UNDER_REVIEW -> REQUIRES_FOLLOW_UP -> UNDER_REVIEW -> APPROVED with history and audit', async () => {
      const addr = await address('custA');
      const eq = await equipment('custA', addr.id);
      const c = await newCase('custA', eq.id, addr.id);

      // customers cannot review; a case cannot skip review
      await http().post(`${API}/cases/${c.id}/review`).set(as('custA')).send({ action: 'START' }).expect(403);
      const skip = await review(c.id, { action: 'APPROVE' }).expect(409);
      expect(skip.body.error.code).toBe('INVALID_TRANSITION');

      expect((await review(c.id, { action: 'START' }).expect(200)).body.status).toBe('UNDER_REVIEW');

      // a follow-up needs the question
      await review(c.id, { action: 'REQUIRE_FOLLOW_UP' }).expect(400);
      const asked = await review(c.id, { action: 'REQUIRE_FOLLOW_UP', reason: 'What is the AC brand and model?' }).expect(200);
      expect(asked.body.status).toBe('REQUIRES_FOLLOW_UP');
      expect(asked.body.case.follow_up_questions[0]).toMatchObject({ question: 'What is the AC brand and model?', answer: null });
      expect(
        await prisma.notification.count({ where: { user_id: ids.custA, request_id: c.id, notification_type: NotificationType.REQUEST_STATUS_CHANGED } }),
      ).toBeGreaterThanOrEqual(1);

      // only the case's customer can answer
      await http().post(`${API}/cases/${c.id}/follow-up-response`).set(as('custB')).send({ answer: 'Acme X1' }).expect(404);
      const answered = await http().post(`${API}/cases/${c.id}/follow-up-response`).set(as('custA')).send({ answer: 'Acme X1' }).expect(200);
      expect(answered.body.status).toBe('UNDER_REVIEW');
      expect(answered.body.case.follow_up_questions[0].answer).toBe('Acme X1');
      // answering again is not allowed
      await http().post(`${API}/cases/${c.id}/follow-up-response`).set(as('custA')).send({ answer: 'again' }).expect(409);

      const approved = await review(c.id, { action: 'APPROVE' }).expect(200);
      expect(approved.body).toMatchObject({ status: 'APPROVED' });
      expect(approved.body.case.verified_by).toBe(ids.dispatcher);
      expect(approved.body.status_history.map((h: { to_status: string }) => h.to_status)).toEqual([
        'NEW', 'UNDER_REVIEW', 'REQUIRES_FOLLOW_UP', 'UNDER_REVIEW', 'APPROVED',
      ]);
      expect(await prisma.auditLog.count({ where: { entity_id: c.id, action: AuditAction.REQUEST_STATUS_CHANGED } })).toBe(4);
      expect(await prisma.auditLog.count({ where: { entity_id: c.id, action: AuditAction.CASE_VERIFIED } })).toBe(1);

      // an approved case can no longer be edited or reviewed again
      await http().patch(`${API}/cases/${c.id}`).set(as('dispatcher')).send({ summary: 'late edit' }).expect(409);
      await review(c.id, { action: 'START' }).expect(409);
    });

    it('lets the dispatcher edit the case while reviewing, and escalates on HIGH urgency', async () => {
      const addr = await address('custA');
      const eq = await equipment('custA', addr.id);
      const c = await newCase('custA', eq.id, addr.id);
      await http().patch(`${API}/cases/${c.id}`).set(as('dispatcher')).send({ summary: 'too early' }).expect(409);
      await review(c.id, { action: 'START' }).expect(200);

      const edited = await http()
        .patch(`${API}/cases/${c.id}`)
        .set(as('dispatcher'))
        .send({ summary: 'Compressor not starting', symptoms: ['warm air', 'clicking noise'], problem_type: 'compressor' })
        .expect(200);
      expect(edited.body.case.summary).toBe('Compressor not starting');
      expect(edited.body.problem_type).toBe('compressor');
      expect(edited.body.is_safety_escalated).toBe(false);

      const urgent = await http().patch(`${API}/cases/${c.id}`).set(as('dispatcher')).send({ urgency_level: 'HIGH' }).expect(200);
      expect(urgent.body.is_safety_escalated).toBe(true);
      await http().patch(`${API}/cases/${c.id}`).set(as('custA')).send({ summary: 'x' }).expect(403);
      await http().patch(`${API}/cases/${c.id}`).set(as('dispatcher')).send({ urgency_level: 'EXTREME' }).expect(400);
    });

    it('rejects a case only with a reason, and the customer sees it', async () => {
      const addr = await address('custA');
      const eq = await equipment('custA', addr.id);
      const c = await newCase('custA', eq.id, addr.id);
      await review(c.id, { action: 'START' }).expect(200);
      await review(c.id, { action: 'REJECT' }).expect(400);
      const rejected = await review(c.id, { action: 'REJECT', reason: 'Outdoor unit is out of scope' }).expect(200);
      expect(rejected.body).toMatchObject({ status: 'REJECTED', rejection_reason: 'Outdoor unit is out of scope' });
      // REJECTED is terminal
      await review(c.id, { action: 'START' }).expect(409);
      await http().post(`${API}/cases/${c.id}/cancel`).set(as('custA')).send({ reason: 'never mind' }).expect(409);
    });
  });

  // ------------------------------------------------------------------ cancellation

  describe('cancellation', () => {
    it('lets the customer cancel before work starts, records who and why, and cannot be repeated', async () => {
      const addr = await address('custA');
      const eq = await equipment('custA', addr.id);
      const c = await newCase('custA', eq.id, addr.id);
      await review(c.id, { action: 'START' }).expect(200);
      await review(c.id, { action: 'APPROVE' }).expect(200);

      await http().post(`${API}/cases/${c.id}/cancel`).set(as('custB')).send({ reason: 'not mine' }).expect(404);
      await http().post(`${API}/cases/${c.id}/cancel`).set(as('custA')).send({ reason: 'x' }).expect(400);
      const cancelled = await http().post(`${API}/cases/${c.id}/cancel`).set(as('custA')).send({ reason: 'Fixed it myself' }).expect(200);
      expect(cancelled.body).toMatchObject({ status: 'CANCELLED', cancellation_reason: 'Fixed it myself', cancelled_by: ids.custA });
      await http().post(`${API}/cases/${c.id}/cancel`).set(as('custA')).send({ reason: 'again please' }).expect(409);
      expect(await prisma.auditLog.count({ where: { entity_id: c.id, action: AuditAction.REQUEST_CANCELLED } })).toBe(1);
    });

    it('cannot cancel work that is already in progress', async () => {
      const addr = await address('custA');
      const eq = await equipment('custA', addr.id);
      const c = await newCase('custA', eq.id, addr.id);
      await prisma.maintenanceRequest.update({ where: { id: c.id }, data: { status: RequestStatus.IN_PROGRESS } });
      const res = await http().post(`${API}/cases/${c.id}/cancel`).set(as('custA')).send({ reason: 'changed my mind' }).expect(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
    });
  });

  // ------------------------------------------------------------------ emergency and unpaid balance

  describe('emergency form and unpaid balance', () => {
    it('creates an escalated EMERGENCY case with a generated title and an urgent dispatcher notification', async () => {
      const addr = await address('custB', { label: 'Default?' });
      const eq = await equipment('custB', addr.id);
      const res = await http()
        .post(`${API}/requests/emergency`)
        .set(as('custB'))
        .send({ equipment_id: eq.id, description: 'Sparks coming out of the unit', contact_preference: 'HOTLINE' })
        .expect(201);

      expect(res.body).toMatchObject({
        title: 'Emergency - Split air conditioner',
        priority: RequestPriority.EMERGENCY,
        status: 'NEW',
        ai_analysis_status: 'SKIPPED',
        is_safety_escalated: true,
        contact_preference: 'HOTLINE',
      });
      expect(res.body.case.source).toBe('MANUAL');
      expect(res.body.address_id).toBeTruthy();

      const note = await prisma.notification.findFirst({
        where: { user_id: ids.dispatcher, request_id: res.body.id, notification_type: NotificationType.SAFETY_ESCALATED },
      });
      expect(note?.priority).toBe('URGENT');
      // an invalid contact preference is refused
      await http()
        .post(`${API}/requests/emergency`)
        .set(as('custB'))
        .send({ equipment_id: eq.id, description: 'x'.repeat(10), contact_preference: 'NOPE' })
        .expect(400);
    });

    it('lets the dispatcher approve an emergency straight from NEW, and reject any case straight from NEW', async () => {
      // NOTE(plan-alignment): UNDER_REVIEW means the dispatcher is checking a case directly. An emergency does not
      // need that step: the dispatcher approves it from NEW. A normal or urgent case still has to be reviewed first.
      const addr = await address('custB');
      const eq = await equipment('custB', addr.id);
      const emergency = (
        await http()
          .post(`${API}/requests/emergency`)
          .set(as('custB'))
          .send({ equipment_id: eq.id, description: 'Smoke and a burning smell', contact_preference: 'FORM' })
          .expect(201)
      ).body as { id: string };

      const approved = await review(emergency.id, { action: 'APPROVE' }).expect(200);
      expect(approved.body.status).toBe('APPROVED');
      expect(approved.body.status_history.map((h: { from_status: string | null; to_status: string }) => [h.from_status, h.to_status])).toEqual([
        [null, 'NEW'],
        ['NEW', 'APPROVED'],
      ]);
      expect(approved.body.case.verified_by).toBe(ids.dispatcher);

      // a normal case cannot skip review
      const normal = await newCase('custB', eq.id, addr.id);
      const refused = await review(normal.id, { action: 'APPROVE' }).expect(409);
      expect(refused.body.error.code).toBe('INVALID_TRANSITION');

      // rejecting straight from NEW needs a reason
      await review(normal.id, { action: 'REJECT' }).expect(400);
      const rejected = await review(normal.id, { action: 'REJECT', reason: 'Not something we repair' }).expect(200);
      expect(rejected.body).toMatchObject({ status: 'REJECTED', rejection_reason: 'Not something we repair' });
    });

    it('blocks normal and urgent requests while there is an unpaid balance, but lets an emergency through with a flag', async () => {
      await createUser('custDebt', Role.CUSTOMER);
      await prisma.customerProfile.update({ where: { user_id: ids.custDebt }, data: { has_unpaid_balance: true, unpaid_amount: 25 } });
      const addr = await address('custDebt');
      const eq = await equipment('custDebt', addr.id);
      const body = { equipment_id: eq.id, address_id: addr.id, title: 'AC', description: 'The AC is broken for days now.' };

      const blocked = await http().post(`${API}/requests`).set(as('custDebt')).send(body).expect(403);
      expect(blocked.body.error.code).toBe('UNPAID_BALANCE');
      await http().post(`${API}/requests`).set(as('custDebt')).send({ ...body, priority: 'URGENT' }).expect(403);

      const emergency = await http()
        .post(`${API}/requests/emergency`)
        .set(as('custDebt'))
        .send({ equipment_id: eq.id, description: 'Gas smell near the unit', contact_preference: 'FORM' })
        .expect(201);
      expect(emergency.body.customer_had_unpaid_balance).toBe(true);
      const note = await prisma.notification.findFirst({
        where: { user_id: ids.dispatcher, request_id: emergency.body.id },
      });
      expect(note?.body).toContain('unpaid balance of 25.00');
      expect(note?.data).toMatchObject({ unpaidAmountCents: 2500 });
      expect(await prisma.maintenanceRequest.count({ where: { customer_id: ids.custDebt } })).toBe(1);
    });
  });

  // ------------------------------------------------------------------ photos

  describe('photos', () => {
    it('needs a file, is owner-only, and fails cleanly (nothing saved) when storage is down', async () => {
      const addr = await address('custA');
      const eq = await equipment('custA', addr.id);
      const c = await newCase('custA', eq.id, addr.id);

      await http().post(`${API}/requests/${c.id}/photos`).set(as('custA')).expect(400);

      const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#888888' } }).png().toBuffer();
      await http().post(`${API}/requests/${c.id}/photos`).set(as('custB')).attach('file', png, 'a.png').expect(404);
      await http().post(`${API}/requests/${c.id}/photos`).set(as('dispatcher')).attach('file', png, 'a.png').expect(403);

      // the e2e environment has no object storage, so a valid upload is refused with 503 and no row is created
      await http().post(`${API}/requests/${c.id}/photos`).set(as('custA')).attach('file', png, 'a.png').expect(503);
      expect(await prisma.attachment.count({ where: { request_id: c.id } })).toBe(0);

      const text = Buffer.from('not an image');
      const bad = await http().post(`${API}/requests/${c.id}/photos`).set(as('custA')).attach('file', text, { filename: 'a.png', contentType: 'image/png' }).expect(400);
      expect(bad.body.error.code).toBe('INVALID_IMAGE');
    });

    it('does not accept photos once the case is approved', async () => {
      const addr = await address('custA');
      const eq = await equipment('custA', addr.id);
      const c = await newCase('custA', eq.id, addr.id);
      await review(c.id, { action: 'START' }).expect(200);
      await review(c.id, { action: 'APPROVE' }).expect(200);
      const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#888888' } }).png().toBuffer();
      const res = await http().post(`${API}/requests/${c.id}/photos`).set(as('custA')).attach('file', png, 'a.png').expect(409);
      expect(res.body.error.code).toBe('PHOTOS_CLOSED');
    });

    it('lets the case\'s customer open its photos but not another customer', async () => {
      const addr = await address('custA');
      const eq = await equipment('custA', addr.id);
      const c = await newCase('custA', eq.id, addr.id);
      // a photo added by staff on the customer's case (storage itself is not needed for the access check)
      const att = await prisma.attachment.create({
        data: { user_id: ids.dispatcher, request_id: c.id, purpose: 'TECHNICIAN_PHOTO', file_url: 'technician_photo/x.png', file_type: 'image/png', file_size: 10 },
      });
      await http().get(`${API}/attachments/${att.id}/url`).set(as('custB')).expect(404);
      // custA owns the request, so access is granted (the signed link needs no storage round trip)
      const ok = await http().get(`${API}/attachments/${att.id}/url`).set(as('custA')).expect(200);
      expect(ok.body.url).toContain('technician_photo/x.png');
    });
  });
});
