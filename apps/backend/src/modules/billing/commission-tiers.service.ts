import { Injectable } from '@nestjs/common';
import { CommissionTierName } from '@prisma/client';
import { Db } from '../../common/db';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** Lowest tier first. "Next tier" always means the following entry in this list. */
export const TIER_ORDER: readonly CommissionTierName[] = [
  CommissionTierName.BRONZE,
  CommissionTierName.SILVER,
  CommissionTierName.GOLD,
];

/**
 * Read-only access to commission_tiers, owned by billing. Other modules (technicians today, billing flows later)
 * get tier data through this service and never query the table themselves. Changing a tier's rate or thresholds
 * belongs to the billing stage, not here.
 */
@Injectable()
export class CommissionTiersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every tier, lowest first. */
  async list(tx?: Db) {
    const rows = await (tx ?? this.prisma).commissionTier.findMany();
    return [...rows].sort((a, b) => TIER_ORDER.indexOf(a.name) - TIER_ORDER.indexOf(b.name));
  }

  findById(id: string, tx?: Db) {
    return (tx ?? this.prisma).commissionTier.findUnique({ where: { id } });
  }

  findByName(name: CommissionTierName, tx?: Db) {
    return (tx ?? this.prisma).commissionTier.findUnique({ where: { name } });
  }

  /** The tier after `current` (the lowest one when the technician has none yet), or null at the top. Pure. */
  nextTierOf<T extends { name: CommissionTierName }>(current: CommissionTierName | null, tiers: readonly T[]): T | null {
    const ordered = [...tiers].sort((a, b) => TIER_ORDER.indexOf(a.name) - TIER_ORDER.indexOf(b.name));
    if (current === null) return ordered[0] ?? null;
    const index = ordered.findIndex((t) => t.name === current);
    return index >= 0 ? (ordered[index + 1] ?? null) : null;
  }
}
