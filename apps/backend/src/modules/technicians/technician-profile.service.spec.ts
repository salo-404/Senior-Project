import { NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, Role } from '@prisma/client';
import { TechnicianProfileService } from './technician-profile.service';

const manager = { id: 'manager-1', roles: [Role.MANAGER] };
const technician = { id: 'tech-user-1', roles: [Role.TECHNICIAN] };

function setup(stats: { count: number; average: number } | null = null) {
  const tx = {
    technicianProfile: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    technicianSkill: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn(), createMany: jest.fn() },
  };
  const prisma = {
    skill: { count: jest.fn() },
    technicianProfile: { updateMany: jest.fn() },
    runInTransaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const reviewStats = { getVisibleStats: jest.fn().mockResolvedValue(stats) };
  const service = new TechnicianProfileService(prisma as never, audit as never, reviewStats as never);
  return { service, prisma, tx, audit, reviewStats };
}

describe('TechnicianProfileService.updateRates', () => {
  it('changes both rates and audits the old and new values in the same transaction', async () => {
    const { service, tx, audit } = setup();
    tx.technicianProfile.findUnique.mockResolvedValue({ id: 'p1', normal_rate: new Prisma.Decimal(20), emergency_rate: new Prisma.Decimal(30) });
    tx.technicianProfile.update.mockResolvedValue({ id: 'p1', normal_rate: new Prisma.Decimal(25.5), emergency_rate: new Prisma.Decimal(40) });

    await service.updateRates(manager, 'p1', { normal_rate: 25.5, emergency_rate: 40 });

    expect(tx.technicianProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: { normal_rate: 25.5, emergency_rate: 40 } }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.USER_UPDATED,
        actorId: manager.id,
        entityId: 'p1',
        oldValue: { normal_rate: '20', emergency_rate: '30' },
        newValue: { normal_rate: '25.5', emergency_rate: '40' },
      }),
      tx,
    );
  });

  it('refuses an emergency rate below the normal rate and writes nothing', async () => {
    const { service, prisma } = setup();
    await expect(service.updateRates(manager, 'p1', { normal_rate: 40, emergency_rate: 30 })).rejects.toMatchObject({
      code: 'INVALID_RATES',
    });
    expect(prisma.runInTransaction).not.toHaveBeenCalled();
  });

  it('404s for an unknown technician', async () => {
    const { service, tx, audit } = setup();
    tx.technicianProfile.findUnique.mockResolvedValue(null);
    await expect(service.updateRates(manager, 'nope', { normal_rate: 20, emergency_rate: 30 })).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('TechnicianProfileService.setSchedule', () => {
  const week = { mon: [{ from: '08:00', to: '17:00' }] };

  it('lets a technician store a valid schedule on their own profile and audits it', async () => {
    const { service, tx, audit } = setup();
    tx.technicianProfile.findFirst.mockResolvedValue({ id: 'p1', weekly_schedule: null });
    const result = await service.setSchedule(technician, 'p1', week);

    expect(tx.technicianProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p1', user_id: technician.id } }));
    expect(tx.technicianProfile.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { weekly_schedule: week } });
    expect(result).toEqual({ id: 'p1', weekly_schedule: week });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ oldValue: { weekly_schedule: null }, newValue: { weekly_schedule: week } }),
      tx,
    );
  });

  it('lets a manager set anyone\'s schedule (no ownership filter)', async () => {
    const { service, tx } = setup();
    tx.technicianProfile.findFirst.mockResolvedValue({ id: 'p1', weekly_schedule: null });
    await service.setSchedule(manager, 'p1', week);
    expect(tx.technicianProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p1' } }));
  });

  it('answers 404 for another technician\'s profile', async () => {
    const { service, tx } = setup();
    tx.technicianProfile.findFirst.mockResolvedValue(null);
    await expect(service.setSchedule(technician, 'someone-elses', week)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.technicianProfile.update).not.toHaveBeenCalled();
  });

  it('clears the schedule with null', async () => {
    const { service, tx } = setup();
    tx.technicianProfile.findFirst.mockResolvedValue({ id: 'p1', weekly_schedule: week });
    const result = await service.setSchedule(technician, 'p1', null);
    expect(tx.technicianProfile.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { weekly_schedule: Prisma.DbNull } });
    expect(result.weekly_schedule).toBeNull();
  });

  it('rejects an invalid schedule with 422 before touching the database', async () => {
    const { service, prisma } = setup();
    await expect(service.setSchedule(technician, 'p1', { mon: [{ from: '17:00', to: '08:00' }] })).rejects.toMatchObject({
      code: 'INVALID_SCHEDULE',
      status: 422,
    });
    expect(prisma.runInTransaction).not.toHaveBeenCalled();
  });
});

describe('TechnicianProfileService.setSkills', () => {
  const dto = { skills: [{ skill_id: 's1', proficiency_level: 4 }, { skill_id: 's2', proficiency_level: 2 }] };

  it('replaces the skills and audits the old and new set', async () => {
    const { service, prisma, tx, audit } = setup();
    prisma.skill.count.mockResolvedValue(2);
    tx.technicianProfile.findUnique.mockResolvedValue({ id: 'p1' });
    tx.technicianSkill.findMany.mockResolvedValue([{ skill_id: 'old', proficiency_level: 1 }]);

    await service.setSkills(manager, 'p1', dto);

    expect(tx.technicianSkill.deleteMany).toHaveBeenCalledWith({ where: { technician_profile_id: 'p1' } });
    expect(tx.technicianSkill.createMany).toHaveBeenCalledWith({
      data: [
        { technician_profile_id: 'p1', skill_id: 's1', proficiency_level: 4 },
        { technician_profile_id: 'p1', skill_id: 's2', proficiency_level: 2 },
      ],
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ oldValue: { skills: [{ skill_id: 'old', proficiency_level: 1 }] } }),
      tx,
    );
  });

  it('refuses duplicate and unknown skills, and an unknown technician', async () => {
    const { service, prisma, tx } = setup();
    await expect(
      service.setSkills(manager, 'p1', { skills: [dto.skills[0], dto.skills[0]] }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_SKILLS' });

    prisma.skill.count.mockResolvedValue(1);
    await expect(service.setSkills(manager, 'p1', dto)).rejects.toMatchObject({ code: 'UNKNOWN_SKILL' });

    prisma.skill.count.mockResolvedValue(2);
    tx.technicianProfile.findUnique.mockResolvedValue(null);
    await expect(service.setSkills(manager, 'nope', dto)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TechnicianProfileService.updateStats', () => {
  it('writes the average rounded to 2 decimals and the review count', async () => {
    const { service, prisma, reviewStats } = setup({ count: 3, average: 4.3333333 });
    prisma.technicianProfile.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.updateStats('p1')).resolves.toBe(true);
    expect(reviewStats.getVisibleStats).toHaveBeenCalledWith('p1', undefined);
    expect(prisma.technicianProfile.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { rating: 4.33, total_reviews: 3 },
    });
  });

  it('sets rating 0 when no review is visible (for example after the last one is hidden)', async () => {
    const { service, prisma } = setup({ count: 0, average: 0 });
    prisma.technicianProfile.updateMany.mockResolvedValue({ count: 1 });
    await service.updateStats('p1');
    expect(prisma.technicianProfile.updateMany.mock.calls[0][0].data).toEqual({ rating: 0, total_reviews: 0 });
  });

  it('never exceeds 5, the most Decimal(3,2) with the 0-5 check allows', async () => {
    const { service, prisma } = setup({ count: 1, average: 7 });
    prisma.technicianProfile.updateMany.mockResolvedValue({ count: 1 });
    await service.updateStats('p1');
    expect(prisma.technicianProfile.updateMany.mock.calls[0][0].data.rating).toBe(5);
  });

  it('uses the caller\'s transaction when given one', async () => {
    const { service, prisma, reviewStats } = setup({ count: 2, average: 4 });
    const own = { technicianProfile: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    await service.updateStats('p1', own as never);
    expect(own.technicianProfile.updateMany).toHaveBeenCalled();
    expect(prisma.technicianProfile.updateMany).not.toHaveBeenCalled();
    expect(reviewStats.getVisibleStats).toHaveBeenCalledWith('p1', own);
  });

  it('does nothing and returns false while the reviews module is not available', async () => {
    const { service, prisma } = setup(null);
    await expect(service.updateStats('p1')).resolves.toBe(false);
    expect(prisma.technicianProfile.updateMany).not.toHaveBeenCalled();
  });

  it('404s when the technician does not exist', async () => {
    const { service, prisma } = setup({ count: 1, average: 4 });
    prisma.technicianProfile.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.updateStats('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
