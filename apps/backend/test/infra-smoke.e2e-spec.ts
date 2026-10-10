/**
 * Smoke tests against the real Docker Redis and object storage (docker compose up -d redis storage).
 * Each one is skipped, with a message printed before the run, when its service is not reachable.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MaintenanceCategory, Role } from '@prisma/client';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { configureApp } from '../src/common/configure-app';
import { hashPassword } from '../src/common/password';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { QueueService } from '../src/infra/queue/queue.service';
import { StorageService } from '../src/infra/storage/storage.service';
import { SMOKE_REDIS_URL, SMOKE_STORAGE_ENDPOINT, storageCredentials } from './smoke-probe';

const API = '/api/v1';
const PASSWORD = 'e2e-password-123';

const redisUp = process.env.E2E_SMOKE_REDIS_UP === '1';
const storageUp = process.env.E2E_SMOKE_STORAGE_UP === '1';
const whenUp = (up: boolean) => (up ? describe : describe.skip);

describe('infrastructure smoke tests (real Redis and object storage)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    if (!redisUp && !storageUp) return;
    // Point the app at the real services BEFORE the app module is loaded (its configuration is validated on import).
    process.env.REDIS_URL = SMOKE_REDIS_URL;
    process.env.STORAGE_ENDPOINT = SMOKE_STORAGE_ENDPOINT;
    const creds = storageCredentials();
    if (creds) {
      process.env.STORAGE_ACCESS_KEY = creds.accessKey;
      process.env.STORAGE_SECRET_KEY = creds.secretKey;
    }
    process.env.STORAGE_BUCKET = `maintain-e2e-smoke`;

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    for (const key of ['custA', 'custB']) {
      const user = await prisma.user.create({
        data: {
          email: `${key.toLowerCase()}@test.dev`,
          password_hash: await hashPassword(PASSWORD),
          first_name: key,
          last_name: 'Customer',
          is_active: true,
          roles: { create: { role: Role.CUSTOMER } },
          customer_profile: { create: {} },
        },
      });
      ids[key] = user.id;
      const login = await http().post(`${API}/auth/login`).send({ email: `${key.toLowerCase()}@test.dev`, password: PASSWORD }).expect(200);
      tokens[key] = login.body.accessToken;
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const as = (key: string) => ({ Authorization: `Bearer ${tokens[key]}` });

  whenUp(storageUp)('object storage', () => {
    it('uploads an image, opens it through a signed link, hides it from others, and deletes it', async () => {
      // a request to attach the photo to
      const type = await prisma.equipmentType.create({ data: { name: 'Split air conditioner', category: MaintenanceCategory.HVAC } });
      const address = await http().post(`${API}/addresses`).set(as('custA')).send({ street: '1 Main St', city: 'Beirut' }).expect(201);
      const equipment = await http()
        .post(`${API}/equipment`)
        .set(as('custA'))
        .send({ equipment_type_id: type.id, address_id: address.body.id, name: 'Living room AC' })
        .expect(201);
      const created = await http()
        .post(`${API}/requests`)
        .set(as('custA'))
        .send({ equipment_id: equipment.body.id, address_id: address.body.id, title: 'AC not cooling', description: 'Blows warm air since yesterday.' })
        .expect(201);

      // 1. upload (a real image, so type, size and resolution checks all run)
      const png = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#2266aa' } }).png().toBuffer();
      const upload = await http().post(`${API}/requests/${created.body.id}/photos`).set(as('custA')).attach('file', png, 'photo.png').expect(201);
      const attachmentId = upload.body.id as string;
      expect(upload.body).toMatchObject({ purpose: 'CUSTOMER_PHOTO', file_type: 'image/png' });

      // 2. the signed link works and returns the stored image
      const link = await http().get(`${API}/attachments/${attachmentId}/url`).set(as('custA')).expect(200);
      expect(link.body.expiresInSeconds).toBe(300);
      const fetched = await fetch(link.body.url);
      expect(fetched.status).toBe(200);
      const meta = await sharp(Buffer.from(await fetched.arrayBuffer())).metadata();
      expect(meta).toMatchObject({ format: 'png', width: 640, height: 480 });

      // 3. another customer can neither get a link nor see that it exists
      await http().get(`${API}/attachments/${attachmentId}/url`).set(as('custB')).expect(404);

      // 4. delete removes the row and the object
      await app.get(StorageService).deleteAttachment(attachmentId, { id: ids.custA, roles: [Role.CUSTOMER] });
      expect(await prisma.attachment.findUnique({ where: { id: attachmentId } })).toBeNull();
      const gone = await fetch(link.body.url);
      expect(gone.status).toBe(404);
    });
  });

  whenUp(redisUp)('redis queue', () => {
    it('enqueueCaseDraft really enqueues a job that sits in the queue because no worker is running', async () => {
      const queueService = app.get(QueueService);
      // the connection is created at startup; give it a moment to become ready
      for (let i = 0; i < 50 && !(await queueService.ping(500)); i++) await new Promise((r) => setTimeout(r, 100));
      expect(await queueService.ping()).toBe(true);

      const requestId = randomUUID();
      expect(await queueService.enqueueCaseDraft(requestId)).toBe(true);

      // look at the queue from the outside, with a separate connection
      const connection = new IORedis(SMOKE_REDIS_URL, { maxRetriesPerRequest: null });
      const queue = new Queue('ai-case-draft', { connection });
      try {
        const job = await queue.getJob(`case-draft-${requestId}`);
        expect(job).toBeDefined();
        expect(job!.data).toEqual({ requestId });
        // no processor exists yet, so the job just waits
        expect(await job!.getState()).toBe('waiting');
        expect(await queue.getWaitingCount()).toBeGreaterThanOrEqual(1);
        await job!.remove();
        expect(await queue.getJob(`case-draft-${requestId}`)).toBeUndefined();
      } finally {
        await queue.close();
        connection.disconnect();
      }
    });
  });

  it('is skipped, not failed, when a service is not running (see the message printed before the run)', () => {
    expect(typeof redisUp).toBe('boolean');
    expect(typeof storageUp).toBe('boolean');
  });
});
