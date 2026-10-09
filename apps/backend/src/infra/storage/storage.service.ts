import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AttachmentPurpose, AuditAction, Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { AppException } from '../../common/app.exception';
import { AuthenticatedUser } from '../../common/authenticated-user';
import type { EnvVars } from '../../config/env.validation';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Minimum resolution so photos are usable for diagnosis. A config value, not a business rule from the plan. */
export const MIN_IMAGE_WIDTH = 320;
export const MIN_IMAGE_HEIGHT = 240;
export const SIGNED_URL_TTL_SECONDS = 5 * 60;

const ALLOWED_TYPES: Record<string, { ext: string; format: 'jpeg' | 'png' | 'webp' }> = {
  'image/jpeg': { ext: 'jpg', format: 'jpeg' },
  'image/png': { ext: 'png', format: 'png' },
  'image/webp': { ext: 'webp', format: 'webp' },
};

export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/** An attachment belongs to exactly one parent (a database check enforces it as well). */
export type AttachmentParent = { requestId: string } | { jobReportId: string } | { conversationId: string };

export interface UploadTarget {
  userId: string;
  purpose: AttachmentPurpose;
  parent: AttachmentParent;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private bucketReady = false;

  constructor(
    config: ConfigService<EnvVars, true>,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    this.bucket = config.get('STORAGE_BUCKET', { infer: true });
    this.s3 = new S3Client({
      region: 'us-east-1',
      endpoint: config.get('STORAGE_ENDPOINT', { infer: true }),
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.get('STORAGE_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('STORAGE_SECRET_KEY', { infer: true }),
      },
      maxAttempts: 1,
      requestHandler: { requestTimeout: 5000, connectionTimeout: 2000 },
    });
  }

  /** Used by the health check. */
  async ping(): Promise<boolean> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }), { abortSignal: AbortSignal.timeout(2500) });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Checks type, size and resolution, strips metadata (EXIF location), saves to the private bucket and creates
   * the attachments row. If storage is down it fails cleanly with 503 and nothing is created.
   */
  async uploadImage(file: UploadedImage, target: UploadTarget) {
    const parentColumns = this.parentColumns(target.parent);

    const type = ALLOWED_TYPES[file.mimetype];
    if (!type) {
      throw new AppException('UNSUPPORTED_IMAGE_TYPE', 'Only JPEG, PNG and WebP images are allowed', 400);
    }
    if (file.size > MAX_IMAGE_BYTES || file.buffer.length > MAX_IMAGE_BYTES) {
      throw new AppException('IMAGE_TOO_LARGE', 'Images can be at most 10 MB', 413);
    }

    let cleaned: Buffer;
    try {
      const image = sharp(file.buffer, { failOn: 'error' });
      const meta = await image.metadata();
      if (meta.format !== type.format) {
        throw new AppException('INVALID_IMAGE', 'The file is not a valid image of the declared type', 400);
      }
      if ((meta.width ?? 0) < MIN_IMAGE_WIDTH || (meta.height ?? 0) < MIN_IMAGE_HEIGHT) {
        throw new AppException(
          'IMAGE_RESOLUTION_TOO_LOW',
          `Images must be at least ${MIN_IMAGE_WIDTH}x${MIN_IMAGE_HEIGHT} pixels`,
          400,
        );
      }
      // rotate() applies the EXIF orientation; sharp drops other metadata by default.
      cleaned = await image.rotate().toBuffer();
    } catch (err) {
      if (err instanceof AppException) throw err;
      throw new AppException('INVALID_IMAGE', 'The file is not a valid image', 400);
    }

    const key = `${target.purpose.toLowerCase()}/${randomUUID()}.${type.ext}`;
    await this.putObject(key, cleaned, file.mimetype);

    try {
      return await this.prisma.attachment.create({
        data: {
          user_id: target.userId,
          purpose: target.purpose,
          file_url: key,
          file_type: file.mimetype,
          file_size: cleaned.length,
          ...parentColumns,
        },
      });
    } catch (err) {
      await this.removeObject(key);
      throw err;
    }
  }

  /**
   * A 5-minute link. The uploader and dispatchers/managers may open it; anyone else gets 404 so the
   * attachment's existence is not revealed. (Access for the request's customer and the assigned technician
   * is added with the requests and dispatch modules.)
   */
  async getSignedUrl(attachmentId: string, user: AuthenticatedUser): Promise<{ url: string; expiresInSeconds: number }> {
    const attachment = await this.findAccessible(attachmentId, user);
    const url = await presign(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: attachment.file_url }), {
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });
    return { url, expiresInSeconds: SIGNED_URL_TTL_SECONDS };
  }

  /** Removes the file and the row. The uploader or a manager only. */
  async deleteAttachment(attachmentId: string, user: AuthenticatedUser): Promise<void> {
    const attachment = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment || !(attachment.user_id === user.id || user.roles.includes(Role.MANAGER))) {
      throw new NotFoundException('Attachment not found');
    }
    await this.removeObject(attachment.file_url);
    await this.prisma.runInTransaction(async (tx) => {
      await tx.attachment.delete({ where: { id: attachmentId } });
      await this.audit.log(
        {
          actorId: user.id,
          action: AuditAction.ATTACHMENT_DELETED,
          entityType: 'attachment',
          entityId: attachmentId,
          oldValue: { purpose: attachment.purpose, uploaded_by: attachment.user_id },
        },
        tx,
      );
    });
  }

  // ---------------------------------------------------------------- helpers

  private async findAccessible(attachmentId: string, user: AuthenticatedUser) {
    const attachment = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    const isStaff = user.roles.includes(Role.DISPATCHER) || user.roles.includes(Role.MANAGER);
    if (!attachment || !(attachment.user_id === user.id || isStaff)) {
      throw new NotFoundException('Attachment not found');
    }
    return attachment;
  }

  private parentColumns(parent: AttachmentParent) {
    const entries = Object.entries(parent).filter(([, v]) => typeof v === 'string' && v.length > 0);
    if (entries.length !== 1) {
      throw new AppException('INVALID_PARENT', 'An attachment needs exactly one parent', 400);
    }
    if ('requestId' in parent) return { request_id: parent.requestId };
    if ('jobReportId' in parent) return { job_report_id: parent.jobReportId };
    return { conversation_id: parent.conversationId };
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
    this.bucketReady = true;
  }

  private async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    try {
      await this.ensureBucket();
      await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
    } catch (err) {
      this.logger.error(`Storage upload failed: ${(err as Error).message}`);
      throw new AppException('STORAGE_UNAVAILABLE', 'File storage is unavailable right now. Please try again later.', 503);
    }
  }

  private async removeObject(key: string): Promise<void> {
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      this.logger.warn(`Could not delete object ${key}: ${(err as Error).message}`);
    }
  }
}
