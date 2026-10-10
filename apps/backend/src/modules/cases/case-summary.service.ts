import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, NotificationType, Prisma, RequestStatus, Role } from '@prisma/client';
import { AppException } from '../../common/app.exception';
import { AuthenticatedUser } from '../../common/authenticated-user';
import { AuditService } from '../../infra/audit/audit.service';
import { NotificationsService } from '../../infra/notifications/notifications.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SafetyService } from '../../infra/safety/safety.service';
import { confirmationOf } from './customer-confirmation';
import { ConfirmSummaryDto } from './dto/summary.dto';

const CLOSED: RequestStatus[] = [RequestStatus.COMPLETED, RequestStatus.CANCELLED, RequestStatus.REJECTED];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const toStringList = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length > 0 ? v.filter((x): x is string => typeof x === 'string') : null;

/**
 * The summary card the customer confirms or corrects (plan 6.4 and 9.9).
 *
 * What the card may show: the device, the problem, the symptoms and the customer's own safety answer.
 * What it NEVER shows: possible causes, urgency, or any AI reasoning. The query below does not even select them.
 * Confirming never changes urgency and never removes a safety flag; it only sets customer_confirmed_at and customer_note.
 */
@Injectable()
export class CaseSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly safety: SafetyService,
    private readonly notifications: NotificationsService,
  ) {}

  /** GET /requests/:id/summary. Built from the case when there is one, otherwise from the form answers. */
  async getSummary(customer: AuthenticatedUser, requestId: string) {
    const request = await this.findOwned(this.prisma, customer.id, requestId);
    return this.build(request);
  }

  /** POST /requests/:id/summary/confirm */
  async confirm(customer: AuthenticatedUser, requestId: string, dto: ConfirmSummaryDto) {
    if (dto.confirmed && dto.note !== undefined) {
      throw new AppException('NOTE_NOT_ALLOWED', 'A confirmation has no note. Send confirmed: false to correct the summary.', 400);
    }
    const note = dto.confirmed ? null : dto.note!.trim();

    const request = await this.prisma.runInTransaction(async (tx) => {
      const found = await this.findOwned(tx, customer.id, requestId);
      if (CLOSED.includes(found.status)) {
        throw new AppException('CASE_CLOSED', 'This case is closed, so its summary can no longer be answered', 409);
      }
      if (!found.case) throw new NotFoundException('Case not found');

      const now = new Date();
      // Only these two columns are written: urgency and safety flags are untouched on purpose.
      await tx.maintenanceCase.update({
        where: { id: found.case.id },
        data: { customer_confirmed_at: now, customer_note: note },
      });
      await this.audit.log(
        {
          actorId: customer.id,
          action: AuditAction.CASE_CONFIRMED_BY_CUSTOMER,
          entityType: 'maintenance_case',
          entityId: found.case.id,
          oldValue: {
            customer_confirmed_at: found.case.customer_confirmed_at?.toISOString() ?? null,
            customer_note: found.case.customer_note,
          },
          newValue: { customer_confirmed_at: now.toISOString(), customer_note: note, confirmed: dto.confirmed },
        },
        tx,
      );
      return { ...found, case: { ...found.case, customer_confirmed_at: now, customer_note: note } };
    });

    // A danger keyword in the correction only produces the fixed question. It never escalates by itself.
    let safetyCheck: { categories: string[]; question: string } | null = null;
    if (note) {
      const result = this.safety.evaluateText(note);
      if (result.hit) {
        safetyCheck = {
          categories: result.categories,
          question: this.safety.confirmationQuestion(result.categories[0], request.language),
        };
      }
      await this.notifications.notifyRole(Role.DISPATCHER, NotificationType.REQUEST_STATUS_CHANGED, {
        title: 'Customer corrected the summary',
        body: `${request.title}: ${note}`,
        requestId,
      });
    }

    return { ...this.build(request), safety_check: safetyCheck };
  }

  // ---------------------------------------------------------------- helpers

  private async findOwned(db: Pick<PrismaService, 'maintenanceRequest'> | Prisma.TransactionClient, customerId: string, id: string) {
    const request = await db.maintenanceRequest.findFirst({
      where: { id, customer_id: customerId },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        language: true,
        problem_type: true,
        intake_answers: true,
        is_safety_escalated: true,
        equipment: { select: { name: true, brand: true, model: true, equipment_type: { select: { name: true, category: true } } } },
        // possible_causes, urgency_level and the other AI fields are deliberately not selected.
        case: { select: { id: true, summary: true, symptoms: true, customer_confirmed_at: true, customer_note: true } },
      },
    });
    // Someone else's request is a 404 so its existence is not revealed.
    if (!request) throw new NotFoundException('Request not found');
    return request;
  }

  private build(request: Awaited<ReturnType<CaseSummaryService['findOwned']>>) {
    const intake = isRecord(request.intake_answers) ? request.intake_answers : {};
    const concern = intake.safety_concern;
    return {
      request_id: request.id,
      // CASE: built from the case record. FORM: a fixed template over what the customer typed.
      source: request.case ? ('CASE' as const) : ('FORM' as const),
      device: {
        name: request.equipment.name,
        type: request.equipment.equipment_type.name,
        category: request.equipment.equipment_type.category,
        brand: request.equipment.brand,
        model: request.equipment.model,
      },
      problem: {
        title: request.title,
        type: request.problem_type,
        description: request.case?.summary ?? request.description,
      },
      symptoms: toStringList(request.case?.symptoms) ?? toStringList(intake.symptoms),
      safety: {
        answer: concern === true ? ('YES' as const) : concern === false ? ('NO' as const) : ('NOT_ANSWERED' as const),
        escalated: request.is_safety_escalated,
      },
      confirmation: confirmationOf(request.case),
    };
  }
}
