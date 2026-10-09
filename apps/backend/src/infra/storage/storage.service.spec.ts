import { NotFoundException } from '@nestjs/common';
import { AttachmentPurpose, AuditAction, Role } from '@prisma/client';
import sharp from 'sharp';
import { MAX_IMAGE_BYTES, StorageService } from './storage.service';

const config = {
  get: (key: string) =>
    ({
      STORAGE_BUCKET: 'maintain-test',
      STORAGE_ENDPOINT: 'http://127.0.0.1:1',
      STORAGE_ACCESS_KEY: 'test-access',
      STORAGE_SECRET_KEY: 'test-secret',
    })[key],
};

function setup() {
  const attachment = { create: jest.fn(), findUnique: jest.fn(), delete: jest.fn() };
  const tx = { attachment };
  const prisma = { attachment, runInTransaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new StorageService(config as never, prisma as never, audit as never);
  return { service, attachment, audit, tx };
}

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#336699' } }).png().toBuffer();

const target = (parent: object = { requestId: 'r1' }) => ({
  userId: 'u1',
  purpose: AttachmentPurpose.CUSTOMER_PHOTO,
  parent: parent as never,
});

describe('StorageService.uploadImage validation', () => {
  it('rejects a type that is not jpeg, png or webp', async () => {
    const { service } = setup();
    const buffer = Buffer.from('GIF89a');
    await expect(
      service.uploadImage({ buffer, mimetype: 'image/gif', size: buffer.length }, target()),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE_TYPE', status: 400 });
  });

  it('rejects files over 10 MB', async () => {
    const { service } = setup();
    const buffer = Buffer.alloc(10);
    await expect(
      service.uploadImage({ buffer, mimetype: 'image/png', size: MAX_IMAGE_BYTES + 1 }, target()),
    ).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE', status: 413 });
  });

  it('rejects a file whose bytes are not an image even if the mimetype says so', async () => {
    const { service } = setup();
    const buffer = Buffer.from('this is not an image at all');
    await expect(
      service.uploadImage({ buffer, mimetype: 'image/png', size: buffer.length }, target()),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });

  it('rejects a real image whose format differs from the declared type', async () => {
    const { service } = setup();
    const buffer = await png(400, 300);
    await expect(
      service.uploadImage({ buffer, mimetype: 'image/jpeg', size: buffer.length }, target()),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });

  it('rejects images below the minimum resolution', async () => {
    const { service } = setup();
    const buffer = await png(100, 100);
    await expect(
      service.uploadImage({ buffer, mimetype: 'image/png', size: buffer.length }, target()),
    ).rejects.toMatchObject({ code: 'IMAGE_RESOLUTION_TOO_LOW' });
  });

  it.each([{}, { requestId: 'r1', jobReportId: 'j1' }, { requestId: '' }])(
    'requires exactly one parent: %j',
    async (parent) => {
      const { service } = setup();
      const buffer = await png(400, 300);
      await expect(
        service.uploadImage({ buffer, mimetype: 'image/png', size: buffer.length }, target(parent)),
      ).rejects.toMatchObject({ code: 'INVALID_PARENT' });
    },
  );

  it('fails cleanly with 503 when storage is down, and creates no attachment row', async () => {
    const { service, attachment } = setup();
    const buffer = await png(400, 300);
    await expect(
      service.uploadImage({ buffer, mimetype: 'image/png', size: buffer.length }, target()),
    ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', status: 503 });
    expect(attachment.create).not.toHaveBeenCalled();
  });
});

describe('StorageService.getSignedUrl ownership', () => {
  const row = { id: 'a1', user_id: 'owner', file_url: 'customer_photo/x.png' };

  it('gives the owner a 5-minute link', async () => {
    const { service, attachment } = setup();
    attachment.findUnique.mockResolvedValue(row);
    const result = await service.getSignedUrl('a1', { id: 'owner', roles: [Role.CUSTOMER] });
    expect(result.expiresInSeconds).toBe(300);
    expect(result.url).toContain('X-Amz-Expires=300');
    expect(result.url).toContain('customer_photo/x.png');
  });

  it.each([Role.DISPATCHER, Role.MANAGER])('lets a %s open any attachment', async (role) => {
    const { service, attachment } = setup();
    attachment.findUnique.mockResolvedValue(row);
    await expect(service.getSignedUrl('a1', { id: 'staff', roles: [role] })).resolves.toHaveProperty('url');
  });

  it.each([Role.CUSTOMER, Role.TECHNICIAN])('answers 404 (not 403) to another %s', async (role) => {
    const { service, attachment } = setup();
    attachment.findUnique.mockResolvedValue(row);
    await expect(service.getSignedUrl('a1', { id: 'someone-else', roles: [role] })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('answers 404 for a missing attachment', async () => {
    const { service, attachment } = setup();
    attachment.findUnique.mockResolvedValue(null);
    await expect(service.getSignedUrl('nope', { id: 'owner', roles: [Role.CUSTOMER] })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('StorageService.deleteAttachment ownership', () => {
  it('answers 404 to a user who is neither the uploader nor a manager', async () => {
    const { service, attachment } = setup();
    attachment.findUnique.mockResolvedValue({ id: 'a1', user_id: 'owner', file_url: 'k' });
    await expect(service.deleteAttachment('a1', { id: 'other', roles: [Role.DISPATCHER] })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(attachment.delete).not.toHaveBeenCalled();
  });

  it('lets the uploader delete, and audits ATTACHMENT_DELETED in the same transaction', async () => {
    const { service, attachment, audit, tx } = setup();
    attachment.findUnique.mockResolvedValue({ id: 'a1', user_id: 'owner', file_url: 'k', purpose: 'CUSTOMER_PHOTO' });
    await service.deleteAttachment('a1', { id: 'owner', roles: [Role.CUSTOMER] });
    expect(attachment.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.ATTACHMENT_DELETED, actorId: 'owner', entityId: 'a1' }),
      tx,
    );
  });

  it('lets a manager delete an attachment uploaded by someone else', async () => {
    const { service, attachment, audit } = setup();
    attachment.findUnique.mockResolvedValue({ id: 'a1', user_id: 'owner', file_url: 'k', purpose: 'CUSTOMER_PHOTO' });
    await service.deleteAttachment('a1', { id: 'boss', roles: [Role.MANAGER] });
    expect(attachment.delete).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'boss' }), expect.anything());
  });
});
