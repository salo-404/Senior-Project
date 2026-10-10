import { NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  CommissionTierName as T,
  NotificationType,
  Prisma,
  ProfileStatus,
  Role,
  TierDecisionOutcome as O,
  TierRequestStatus,
  TierRequestType,
} from '@prisma/client';
import { CommissionTiersService } from '../billing/commission-tiers.service';
import { encodePayload } from './tier-request-payload';
import { TierRequestsService } from './tier-requests.service';

const manager = { id: 'manager-1', roles: [Role.MANAGER] };
const technician = { id: 'tech-user-1', roles: [Role.TECHNICIAN] };
const dec = (n: number) => new Prisma.Decimal(n);

function setup() {
  const tx = {
    technicianTierRequest: { count: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    technicianProfile: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    technicianSkill: { createMany: jest.fn() },
  };
  const prisma = {
    technicianProfile: { findUnique: jest.fn(), findMany: jest.fn() },
    technicianTierRequest: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    skill: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    runInTransaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const notifications = { notify: jest.fn().mockResolvedValue('n1'), notifyRole: jest.fn().mockResolvedValue(1) };
  const tierRows = [
    { id: 'tier-b', name: T.BRONZE, min_rating: null, min_experience_years: null, min_completed_jobs: null },
    { id: 'tier-s', name: T.SILVER, min_rating: dec(4), min_experience_years: 3, min_completed_jobs: 10 },
    { id: 'tier-g', name: T.GOLD, min_rating: dec(4.5), min_experience_years: 6, min_completed_jobs: 40 },
  ];
  const tiers = new CommissionTiersService({} as never);
  jest.spyOn(tiers, 'list').mockResolvedValue(tierRows as never);
  jest.spyOn(tiers, 'findById').mockImplementation((async (id: string) => tierRows.find((t) => t.id === id) ?? null) as never);
  const completedJobs = { countCompleted: jest.fn().mockResolvedValue(new Map()) };
  const service = new TierRequestsService(prisma as never, audit as never, notifications as never, tiers, completedJobs as never);
  return { service, prisma, tx, audit, notifications, tiers, completedJobs, tierRows };
}

describe('TierRequestsService.request (requestTierUpdate)', () => {
  const approved = { id: 'p1', profile_status: ProfileStatus.APPROVED, user: { first_name: 'Ali', last_name: 'Tech' } };

  it('creates a TIER_UPDATE with the notes and requested skills, audits it, and notifies the managers', async () => {
    const { service, prisma, tx, audit, notifications } = setup();
    prisma.technicianProfile.findUnique.mockResolvedValue(approved);
    prisma.skill.count.mockResolvedValue(2);
    tx.technicianTierRequest.count.mockResolvedValue(0);
    tx.technicianTierRequest.create.mockResolvedValue({ id: 'r1' });

    await expect(service.request(technician, { notes: 'Five new certificates', skillIds: ['s1', 's2'] })).resolves.toEqual({
      id: 'r1',
      status: TierRequestStatus.PENDING,
    });

    const data = tx.technicianTierRequest.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ technician_profile_id: 'p1', request_type: TierRequestType.TIER_UPDATE });
    expect(JSON.parse(data.supporting_notes)).toEqual({ notes: 'Five new certificates', skill_ids: ['s1', 's2'] });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'r1', actorId: technician.id }), tx);
    expect(notifications.notifyRole).toHaveBeenCalledWith(Role.MANAGER, NotificationType.SYSTEM, expect.any(Object));
  });

  it('works without skills', async () => {
    const { service, prisma, tx } = setup();
    prisma.technicianProfile.findUnique.mockResolvedValue(approved);
    tx.technicianTierRequest.count.mockResolvedValue(0);
    tx.technicianTierRequest.create.mockResolvedValue({ id: 'r1' });
    await service.request(technician, { notes: 'Please review my tier' });
    expect(prisma.skill.count).not.toHaveBeenCalled();
  });

  it.each([ProfileStatus.PENDING_REVIEW, ProfileStatus.REJECTED])('refuses a %s technician', async (status) => {
    const { service, prisma } = setup();
    prisma.technicianProfile.findUnique.mockResolvedValue({ ...approved, profile_status: status });
    await expect(service.request(technician, { notes: 'Please review' })).rejects.toMatchObject({ code: 'NOT_APPROVED' });
  });

  it('refuses a second open request, an unknown skill and a user without a profile', async () => {
    const { service, prisma, tx } = setup();
    prisma.technicianProfile.findUnique.mockResolvedValue(approved);
    tx.technicianTierRequest.count.mockResolvedValue(1);
    await expect(service.request(technician, { notes: 'Again please' })).rejects.toMatchObject({ code: 'REQUEST_PENDING' });

    prisma.skill.count.mockResolvedValue(0);
    await expect(service.request(technician, { notes: 'With a ghost skill', skillIds: ['ghost'] })).rejects.toMatchObject({
      code: 'UNKNOWN_SKILL',
    });

    prisma.technicianProfile.findUnique.mockResolvedValue(null);
    await expect(service.request(technician, { notes: 'No profile here' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TierRequestsService.decide (decideTierRequest)', () => {
  const pending = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    technician_profile_id: 'p1',
    request_type: TierRequestType.TIER_UPDATE,
    status: TierRequestStatus.PENDING,
    proposed_tier_id: null,
    supporting_notes: encodePayload({ notes: 'More skills', skill_ids: ['s1', 's2'] }),
    ...over,
  });

  function ready(over: Record<string, unknown> = {}) {
    const ctx = setup();
    ctx.prisma.technicianTierRequest.findUnique.mockResolvedValue(pending(over));
    ctx.prisma.technicianTierRequest.findUniqueOrThrow.mockResolvedValue({
      ...pending(over),
      technician: { id: 'p1', user: { id: 'tu1' } },
      proposed_tier: null,
      final_tier: null,
    });
    ctx.tx.technicianTierRequest.updateMany.mockResolvedValue({ count: 1 });
    ctx.tx.technicianProfile.findUniqueOrThrow.mockResolvedValue({ id: 'p1', user_id: 'tu1', current_tier_id: 'tier-b' });
    return ctx;
  }

  it('TIER_CHANGED sets the tier, audits TIER_CHANGED and tells the technician', async () => {
    const { service, tx, audit, notifications } = ready();
    await service.decide('r1', manager, { outcome: O.TIER_CHANGED, finalTierId: 'tier-s', notes: 'Well deserved' });

    expect(tx.technicianTierRequest.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'r1', status: TierRequestStatus.PENDING },
      data: { status: TierRequestStatus.APPROVED, decision_outcome: O.TIER_CHANGED, final_tier_id: 'tier-s', reviewed_by: manager.id },
    });
    expect(tx.technicianProfile.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { current_tier_id: 'tier-s' } });
    expect(tx.technicianSkill.createMany).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.TIER_CHANGED,
        actorId: manager.id,
        oldValue: { current_tier_id: 'tier-b' },
        newValue: expect.objectContaining({ current_tier_id: 'tier-s', tier: T.SILVER }),
      }),
      tx,
    );
    expect(notifications.notify).toHaveBeenCalledWith('tu1', NotificationType.TIER_CHANGED, expect.objectContaining({ title: 'Your tier is now SILVER' }));
  });

  it('TIER_CHANGED falls back to the proposed tier, and needs one of them', async () => {
    const withProposal = ready({ proposed_tier_id: 'tier-g' });
    await withProposal.service.decide('r1', manager, { outcome: O.TIER_CHANGED });
    expect(withProposal.tx.technicianProfile.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { current_tier_id: 'tier-g' } });

    const without = ready();
    await expect(without.service.decide('r1', manager, { outcome: O.TIER_CHANGED })).rejects.toMatchObject({ code: 'TIER_REQUIRED' });
    await expect(without.service.decide('r1', manager, { outcome: O.TIER_CHANGED, finalTierId: 'nope' })).rejects.toMatchObject({
      code: 'TIER_NOT_FOUND',
    });
    expect(without.tx.technicianTierRequest.updateMany).not.toHaveBeenCalled();
  });

  it('SKILLS_NOTED_ONLY adds the requested skills and leaves the tier and commission alone', async () => {
    const { service, prisma, tx, audit, notifications } = ready();
    prisma.skill.count.mockResolvedValue(2);

    await service.decide('r1', manager, { outcome: O.SKILLS_NOTED_ONLY });

    expect(tx.technicianSkill.createMany).toHaveBeenCalledWith({
      data: [
        { technician_profile_id: 'p1', skill_id: 's1', proficiency_level: 1 },
        { technician_profile_id: 'p1', skill_id: 's2', proficiency_level: 1 },
      ],
      skipDuplicates: true,
    });
    expect(tx.technicianProfile.update).not.toHaveBeenCalled();
    expect(tx.technicianTierRequest.updateMany.mock.calls[0][0].data).toMatchObject({
      status: TierRequestStatus.APPROVED,
      decision_outcome: O.SKILLS_NOTED_ONLY,
      final_tier_id: null,
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.USER_UPDATED }), tx);
    expect(notifications.notify).toHaveBeenCalledWith('tu1', NotificationType.SYSTEM, expect.any(Object));
  });

  it('SKILLS_NOTED_ONLY needs skills on the request and skills that still exist', async () => {
    const empty = ready({ supporting_notes: encodePayload({ notes: 'No skills', skill_ids: [] }) });
    await expect(empty.service.decide('r1', manager, { outcome: O.SKILLS_NOTED_ONLY })).rejects.toMatchObject({ code: 'NO_SKILLS_REQUESTED' });

    const gone = ready();
    gone.prisma.skill.count.mockResolvedValue(1);
    await expect(gone.service.decide('r1', manager, { outcome: O.SKILLS_NOTED_ONLY })).rejects.toMatchObject({ code: 'UNKNOWN_SKILL' });
  });

  it('NO_CHANGE closes the request as REJECTED without touching the profile', async () => {
    const { service, tx } = ready();
    await service.decide('r1', manager, { outcome: O.NO_CHANGE, notes: 'Not enough jobs yet' });
    expect(tx.technicianTierRequest.updateMany.mock.calls[0][0].data).toMatchObject({
      status: TierRequestStatus.REJECTED,
      decision_outcome: O.NO_CHANGE,
      review_notes: 'Not enough jobs yet',
    });
    expect(tx.technicianProfile.update).not.toHaveBeenCalled();
    expect(tx.technicianSkill.createMany).not.toHaveBeenCalled();
  });

  it('returns 409 ALREADY_DECIDED when another manager decided first, and changes nothing else', async () => {
    const { service, tx, audit, notifications } = ready();
    tx.technicianTierRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.decide('r1', manager, { outcome: O.TIER_CHANGED, finalTierId: 'tier-s' })).rejects.toMatchObject({
      code: 'ALREADY_DECIDED',
    });
    expect(tx.technicianProfile.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('refuses an initial application and answers 404 for an unknown request', async () => {
    const { service, prisma } = ready({ request_type: TierRequestType.INITIAL_APPLICATION });
    await expect(service.decide('r1', manager, { outcome: O.NO_CHANGE, notes: 'x' })).rejects.toMatchObject({ code: 'NOT_A_TIER_UPDATE' });
    prisma.technicianTierRequest.findUnique.mockResolvedValue(null);
    await expect(service.decide('nope', manager, { outcome: O.NO_CHANGE, notes: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TierRequestsService.suggestTierUpdates (the nightly job)', () => {
  const profile = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    years_of_experience: 4,
    rating: dec(4.2),
    current_tier_id: 'tier-b',
    ...over,
  });

  function run(profiles: unknown[], completed: Record<string, number>, waiting: string[] = []) {
    const ctx = setup();
    ctx.prisma.technicianProfile.findMany.mockResolvedValue(profiles);
    ctx.prisma.technicianTierRequest.findMany.mockResolvedValue(waiting.map((id) => ({ technician_profile_id: id })));
    ctx.completedJobs.countCompleted.mockResolvedValue(new Map(Object.entries(completed)));
    ctx.tx.technicianTierRequest.create.mockResolvedValue({ id: 'new-request' });
    return ctx;
  }

  it('proposes the next tier for a technician who meets every threshold, and notifies the managers once', async () => {
    const { service, tx, audit, notifications } = run([profile('p1')], { p1: 12 });
    await expect(service.suggestTierUpdates()).resolves.toEqual({ proposed: 1 });

    const data = tx.technicianTierRequest.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ technician_profile_id: 'p1', request_type: TierRequestType.TIER_UPDATE, proposed_tier_id: 'tier-s' });
    expect(JSON.parse(data.supporting_notes)).toMatchObject({ suggested: true, skill_ids: [] });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ actorId: null }), tx);
    expect(notifications.notifyRole).toHaveBeenCalledTimes(1);
  });

  it('never changes a tier by itself', async () => {
    const { service, tx } = run([profile('p1')], { p1: 12 });
    await service.suggestTierUpdates();
    expect(tx.technicianProfile.update).not.toHaveBeenCalled();
  });

  it.each([
    ['rating too low', { rating: dec(3.9) }, 12],
    ['not enough experience', { years_of_experience: 2 }, 12],
    ['not enough completed jobs', {}, 9],
  ])('skips a technician with %s', async (_name, over, jobs) => {
    const { service, tx } = run([profile('p1', over)], { p1: jobs });
    await expect(service.suggestTierUpdates()).resolves.toEqual({ proposed: 0 });
    expect(tx.technicianTierRequest.create).not.toHaveBeenCalled();
  });

  it('counts a technician with no completed jobs as 0', async () => {
    const { service } = run([profile('p1')], {});
    await expect(service.suggestTierUpdates()).resolves.toEqual({ proposed: 0 });
  });

  it('skips a technician who already has a request waiting', async () => {
    const { service } = run([profile('p1')], { p1: 12 }, ['p1']);
    await expect(service.suggestTierUpdates()).resolves.toEqual({ proposed: 0 });
  });

  it('skips the top tier, and a tier whose thresholds are empty', async () => {
    const top = run([profile('p1', { current_tier_id: 'tier-g' })], { p1: 99 });
    await expect(top.service.suggestTierUpdates()).resolves.toEqual({ proposed: 0 });

    // The next tier after "no tier yet" is BRONZE, whose thresholds are all null: skipped.
    const noTier = run([profile('p1', { current_tier_id: null })], { p1: 99 });
    await expect(noTier.service.suggestTierUpdates()).resolves.toEqual({ proposed: 0 });
  });

  it('skips a tier when any single threshold is empty (it cannot be evaluated)', async () => {
    const ctx = run([profile('p1')], { p1: 12 });
    ctx.tierRows[1].min_completed_jobs = null as never;
    await expect(ctx.service.suggestTierUpdates()).resolves.toEqual({ proposed: 0 });
  });

  it('handles several technicians and does nothing (and notifies nobody) when there are none', async () => {
    const many = run([profile('p1'), profile('p2', { rating: dec(1) }), profile('p3', { current_tier_id: 'tier-s', years_of_experience: 7, rating: dec(4.8) })], {
      p1: 12,
      p2: 50,
      p3: 45,
    });
    await expect(many.service.suggestTierUpdates()).resolves.toEqual({ proposed: 2 });
    expect(many.tx.technicianTierRequest.create.mock.calls.map((c) => c[0].data.proposed_tier_id)).toEqual(['tier-s', 'tier-g']);

    const none = run([], {});
    await expect(none.service.suggestTierUpdates()).resolves.toEqual({ proposed: 0 });
    expect(none.notifications.notifyRole).not.toHaveBeenCalled();
  });
});
