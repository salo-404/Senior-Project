import { CommissionTierName as T } from '@prisma/client';
import { CommissionTiersService } from './commission-tiers.service';

const service = new CommissionTiersService({ commissionTier: {} } as never);
const tiers = [{ name: T.GOLD }, { name: T.BRONZE }, { name: T.SILVER }];

describe('CommissionTiersService.nextTierOf', () => {
  it('returns the following tier, whatever order the rows come in', () => {
    expect(service.nextTierOf(T.BRONZE, tiers)).toEqual({ name: T.SILVER });
    expect(service.nextTierOf(T.SILVER, tiers)).toEqual({ name: T.GOLD });
  });

  it('returns null at the top tier and for an unknown tier', () => {
    expect(service.nextTierOf(T.GOLD, tiers)).toBeNull();
    expect(service.nextTierOf(T.SILVER, [{ name: T.BRONZE }])).toBeNull();
  });

  it('starts from the lowest tier when the technician has none', () => {
    expect(service.nextTierOf(null, tiers)).toEqual({ name: T.BRONZE });
    expect(service.nextTierOf(null, [])).toBeNull();
  });
});

describe('CommissionTiersService.list', () => {
  it('returns the tiers lowest first', async () => {
    const svc = new CommissionTiersService({
      commissionTier: { findMany: jest.fn().mockResolvedValue([{ name: T.GOLD }, { name: T.BRONZE }, { name: T.SILVER }]) },
    } as never);
    expect((await svc.list()).map((t) => t.name)).toEqual([T.BRONZE, T.SILVER, T.GOLD]);
  });
});
