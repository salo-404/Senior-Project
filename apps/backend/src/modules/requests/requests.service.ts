import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AiAnalysisStatus,
  AuditAction,
  AttachmentPurpose,
  CaseSource,
  NotificationPriority,
  NotificationType,
  Prisma,
  RequestPriority,
  RequestStatus,
  Role,
} from '@prisma/client';
import { AppException } from '../../common/app.exception';
import { AuthenticatedUser } from '../../common/authenticated-user';
import { Db } from '../../common/db';
import { AuditService } from '../../infra/audit/audit.service';
import { NotificationsService } from '../../infra/notifications/notifications.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SafetyService } from '../../infra/safety/safety.service';
import { StorageService, UploadedImage } from '../../infra/storage/storage.service';
import { AddressesService } from '../addresses/addresses.service';
import { CaseLifecycleService } from '../cases/case-lifecycle.service';
import { EquipmentService } from '../equipment/equipment.service';
import { UsersService } from '../users/users.service';
import { CreateEmergencyDto, CreateRequestDto } from './dto/requests.dto';

/** Photos can be added only while the dispatcher can still use them. */
const PHOTO_STATUSES: RequestStatus[] = [RequestStatus.NEW, RequestStatus.UNDER_REVIEW, RequestStatus.REQUIRES_FOLLOW_UP];
export const MAX_PHOTOS_PER_REQUEST = 5;
const CLOSED_STATUSES: RequestStatus[] = [RequestStatus.COMPLETED, RequestStatus.CANCELLED, RequestStatus.REJECTED];

const REQUEST_INCLUDE = { case: true, equipment: { include: { equipment_type: true } }, address: true } as const;

interface Submitted {
  request: Prisma.MaintenanceRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;
  escalated: boolean;
  unpaidAmountCents: number;
}

/** Customer submissions: the manual (no-AI) path for normal, urgent and emergency requests. */
@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lifecycle: CaseLifecycleService,
    private readonly users: UsersService,
    private readonly equipment: EquipmentService,
    private readonly addresses: AddressesService,
    private readonly safety: SafetyService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  // ---------------------------------------------------------------- submissions

  /** NORMAL / URGENT. Blocked while the customer has an unpaid balance. */
  async createManual(customer: AuthenticatedUser, dto: CreateRequestDto) {
    const priority = dto.priority ?? RequestPriority.NORMAL;

    const submitted = await this.prisma.runInTransaction(async (tx): Promise<Submitted> => {
      await this.equipment.findOwned(customer.id, dto.equipment_id, tx);
      await this.addresses.findOwned(customer.id, dto.address_id, tx);
      const balance = await this.users.assertCanCreateRequest(customer.id, priority, tx);

      const request = await tx.maintenanceRequest.create({
        data: {
          customer_id: customer.id,
          equipment_id: dto.equipment_id,
          address_id: dto.address_id,
          title: dto.title,
          description: dto.description,
          priority,
          status: RequestStatus.NEW,
          ai_analysis_status: AiAnalysisStatus.SKIPPED,
          problem_type: dto.problem_type,
          intake_answers: dto.intake_answers as Prisma.InputJsonValue | undefined,
          language: dto.language,
          customer_had_unpaid_balance: balance.flagUnpaidBalance,
        },
        select: { id: true },
      });
      await this.createCase(tx, request.id, customer.id, dto.description);
      await this.lifecycle.recordCreated(tx, request.id, customer.id, { priority, source: CaseSource.MANUAL });

      // Only a clear Yes to the form's safety question escalates; a keyword alone never does.
      const escalated = this.safety.evaluateIntake(dto.intake_answers).hit;
      if (escalated) await this.lifecycle.escalate(tx, request.id, customer.id, 'Customer answered Yes to the safety question', { raisePriority: true });

      return { request: await this.load(tx, request.id), escalated, unpaidAmountCents: balance.unpaidAmountCents };
    });

    await this.notifyDispatchers(submitted, priority === RequestPriority.URGENT);
    return submitted.request;
  }

  /** EMERGENCY: short form, generated title, no AI, always accepted (an unpaid balance is only flagged). */
  async createEmergency(customer: AuthenticatedUser, dto: CreateEmergencyDto) {
    const submitted = await this.prisma.runInTransaction(async (tx): Promise<Submitted> => {
      const equipment = await this.equipment.findOwned(customer.id, dto.equipment_id, tx, true);
      const address = dto.address_id
        ? await this.addresses.findOwned(customer.id, dto.address_id, tx)
        : await this.addresses.findDefault(customer.id, tx);
      if (!address) {
        throw new AppException('ADDRESS_REQUIRED', 'Add an address first, or choose one for this request', 400);
      }
      const balance = await this.users.assertCanCreateRequest(customer.id, RequestPriority.EMERGENCY, tx);

      const typeName = (equipment as { equipment_type?: { name: string } }).equipment_type?.name ?? 'equipment';
      const request = await tx.maintenanceRequest.create({
        data: {
          customer_id: customer.id,
          equipment_id: dto.equipment_id,
          address_id: address.id,
          title: `Emergency - ${typeName}`,
          description: dto.description,
          priority: RequestPriority.EMERGENCY,
          status: RequestStatus.NEW,
          ai_analysis_status: AiAnalysisStatus.SKIPPED,
          contact_preference: dto.contact_preference,
          language: dto.language,
          customer_had_unpaid_balance: balance.flagUnpaidBalance,
        },
        select: { id: true },
      });
      await this.createCase(tx, request.id, customer.id, dto.description);
      await this.lifecycle.recordCreated(tx, request.id, customer.id, {
        priority: RequestPriority.EMERGENCY,
        source: CaseSource.MANUAL,
        emergency_form: true,
      });
      await this.lifecycle.escalate(tx, request.id, customer.id, 'Emergency form');

      return { request: await this.load(tx, request.id), escalated: true, unpaidAmountCents: balance.unpaidAmountCents };
    });

    await this.notifyDispatchers(submitted, true);
    return submitted.request;
  }

  // ---------------------------------------------------------------- safety confirmation

  /**
   * The customer's answer to the fixed safety question. A keyword never escalates on its own; only this clear "yes" does,
   * through the existing escalate path: EMERGENCY priority, is_safety_escalated, a SAFETY_ESCALATED audit row, and
   * every dispatcher notified (after the transaction commits). "no" changes nothing. Answering "yes" twice is harmless.
   */
  async confirmSafety(customer: AuthenticatedUser, requestId: string, answer: 'yes' | 'no') {
    const request = await this.prisma.maintenanceRequest.findFirst({
      where: { id: requestId, customer_id: customer.id },
      select: { id: true, title: true, status: true, priority: true, is_safety_escalated: true },
    });
    // Someone else's request is a 404 so its existence is not revealed.
    if (!request) throw new NotFoundException('Request not found');

    if (answer === 'no') {
      return { id: request.id, escalated: request.is_safety_escalated, priority: request.priority, changed: false };
    }
    if (CLOSED_STATUSES.includes(request.status)) {
      throw new AppException('CASE_CLOSED', 'This case is closed', 409);
    }

    const changed = await this.prisma.runInTransaction((tx) =>
      this.lifecycle.escalate(tx, requestId, customer.id, 'Customer confirmed a safety danger', { raisePriority: true }),
    );
    if (changed) {
      await this.notifications.notifyRole(Role.DISPATCHER, NotificationType.SAFETY_ESCALATED, {
        title: `Safety escalation: ${request.title}`,
        body: 'The customer confirmed a safety danger.',
        requestId,
        priority: NotificationPriority.URGENT,
      });
    }
    return { id: request.id, escalated: true, priority: RequestPriority.EMERGENCY, changed };
  }

  // ---------------------------------------------------------------- photos

  /** Customer evidence photo. The image rules (type, size, resolution, metadata) live in StorageService. */
  async addPhoto(customer: AuthenticatedUser, requestId: string, file: UploadedImage | undefined) {
    if (!file) throw new AppException('FILE_REQUIRED', 'Attach an image in the "file" field', 400);

    const request = await this.prisma.maintenanceRequest.findFirst({
      where: { id: requestId, customer_id: customer.id },
      select: { status: true, _count: { select: { attachments: true } } },
    });
    if (!request) throw new NotFoundException('Case not found');
    if (!PHOTO_STATUSES.includes(request.status)) {
      throw new AppException('PHOTOS_CLOSED', 'Photos can no longer be added to this case', 409);
    }
    if (request._count.attachments >= MAX_PHOTOS_PER_REQUEST) {
      throw new AppException('TOO_MANY_PHOTOS', `A case can have at most ${MAX_PHOTOS_PER_REQUEST} photos`, 409);
    }

    const attachment = await this.storage.uploadImage(file, {
      userId: customer.id,
      purpose: AttachmentPurpose.CUSTOMER_PHOTO,
      parent: { requestId },
    });
    return { id: attachment.id, purpose: attachment.purpose, file_type: attachment.file_type, file_size: attachment.file_size };
  }

  // ---------------------------------------------------------------- notifications

  /** After the transaction commits: tell every dispatcher. A failed notification never undoes the request. */
  async notifyDispatchers(submitted: Submitted, highPriority: boolean): Promise<void> {
    const { request, escalated, unpaidAmountCents } = submitted;
    const unpaid = unpaidAmountCents > 0 ? ` The customer has an unpaid balance of ${(unpaidAmountCents / 100).toFixed(2)}.` : '';
    await this.notifications.notifyRole(
      Role.DISPATCHER,
      escalated ? NotificationType.SAFETY_ESCALATED : NotificationType.REQUEST_SUBMITTED,
      {
        title: escalated ? `Safety escalation: ${request.title}` : `New request: ${request.title}`,
        body: `${request.equipment.equipment_type.name} (${request.priority}).${unpaid}`,
        requestId: request.id,
        priority: escalated ? NotificationPriority.URGENT : highPriority ? NotificationPriority.HIGH : NotificationPriority.NORMAL,
        data: { priority: request.priority, ...(unpaidAmountCents > 0 ? { unpaidAmountCents } : {}) },
      },
    );
  }

  // ---------------------------------------------------------------- helpers

  private async createCase(tx: Db, requestId: string, actorId: string, summary: string): Promise<void> {
    const created = await tx.maintenanceCase.create({
      data: { request_id: requestId, source: CaseSource.MANUAL, summary },
      select: { id: true },
    });
    await this.audit.log(
      { actorId, action: AuditAction.CASE_CREATED_MANUAL, entityType: 'maintenance_case', entityId: created.id },
      tx,
    );
  }

  private load(tx: Db, id: string) {
    return tx.maintenanceRequest.findUniqueOrThrow({ where: { id }, include: REQUEST_INCLUDE });
  }
}
