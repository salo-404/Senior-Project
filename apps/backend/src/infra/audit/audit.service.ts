import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { Db } from '../../common/db';
import { getRequestContext } from '../../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  /** Null for system actions and for failed logins of unknown users. */
  actorId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  oldValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
  ip?: string;
}

/** Writes append-only audit rows. Never updates or deletes (the database trigger enforces it too). */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pass the caller's `tx` so the audit row commits or rolls back together with the change it describes. */
  async log(entry: AuditEntry, tx?: Db): Promise<void> {
    const db = tx ?? this.prisma;
    const ctx = getRequestContext();
    await db.auditLog.create({
      data: {
        user_id: entry.actorId,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        old_value: entry.oldValue,
        new_value: entry.newValue,
        ip_address: entry.ip ?? ctx?.ip,
        correlation_id: ctx?.correlationId,
      },
    });
  }

  findByEntity(entityType: string, entityId: string, tx?: Db) {
    const db = tx ?? this.prisma;
    return db.auditLog.findMany({
      where: { entity_type: entityType, entity_id: entityId },
      orderBy: { created_at: 'asc' },
    });
  }
}
