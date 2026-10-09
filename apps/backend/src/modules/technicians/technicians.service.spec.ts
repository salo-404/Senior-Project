import { NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, ProfileStatus, Role, TierRequestStatus, TierRequestType } from '@prisma/client';
import { TechniciansService } from './technicians.service';

jest.mock('../../common/password', () => ({ hashPassword: jest.fn(async () => 'hashed') }));

const manager = { id: 'manager-1', roles: [Role.MANAGER] };
const technician = { id: 'tech-user-1', roles: [Role.TECHNICIAN] };

const details = {
  skills: [
    { skill_id: 's1', proficiency_level: 4 },
    { skill_id: 's2', proficiency_level: 3 },
  ],
  years_of_experience: 6,
  bio: 'Six years repairing split and central AC units.',
  normal_rate: 30,
  emergency_rate: 50,
  proposed_tier: undefined,
  supporting_notes: 'HVAC certificate',
};

const registerDto = {
  email: 'Ali@Test.dev',
  password: 'a-long-password',
  first_name: 'Ali',
  last_name: 'Tech',
  phone: undefined,
  application: details,
};

function setup() {
  const tx = {
    user: { create: jest.fn() },
    technicianProfile: { updateMany: jest.fn(), update: jest.fn() },
    technicianSkill: { deleteMany: jest.fn(), createMany: jest.fn() },
    technicianTierRequest: { create: jest.fn(), updateMany: jest.fn() },
  };
  const prisma = {
    skill: { count: jest.fn().mockResolvedValue(2), findMany: jest.fn() },
    commissionTier: { findUnique: jest.fn() },
    technicianProfile: { findUnique: jest.fn() },
    technicianTierRequest: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    runInTransaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new TechniciansService(prisma as never, audit as never);
  return { service, prisma, tx, audit };
}

const uniqueError = (target: string[]) =>
  new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test', meta: { target } });

describe('TechniciansService', () => {
  describe('registerApplicant', () => {
    it('creates a TECHNICIAN account with a PENDING_REVIEW profile, its skills, and an INITIAL_APPLICATION', async () => {
      const { service, tx, audit } = setup();
      tx.user.create.mockResolvedValue({
        id: 'u1',
        email: 'ali@test.dev',
        first_name: 'Ali',
        last_name: 'Tech',
        technician_profile: { id: 'p1' },
      });
      tx.technicianTierRequest.create.mockResolvedValue({ id: 'app1' });

      const result = await service.registerApplicant(registerDto as never);

      const data = tx.user.create.mock.calls[0][0].data;
      expect(data.email).toBe('ali@test.dev');
      expect(data.password_hash).toBe('hashed');
      expect(data.roles).toEqual({ create: { role: Role.TECHNICIAN } });
      expect(data.technician_profile.create.profile_status).toBe(ProfileStatus.PENDING_REVIEW);
      expect(data.technician_profile.create.skills.create).toHaveLength(2);
      expect(tx.technicianTierRequest.create.mock.calls[0][0].data).toMatchObject({
        technician_profile_id: 'p1',
        request_type: TierRequestType.INITIAL_APPLICATION,
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.USER_CREATED, entityId: 'p1' }),
        tx,
      );
      expect(result).toMatchObject({ application_id: 'app1', status: TierRequestStatus.PENDING });
      expect(result.user.roles).toEqual([Role.TECHNICIAN]);
    });

    it('rejects an emergency rate below the normal rate', async () => {
      const { service, tx } = setup();
      await expect(
        service.registerApplicant({ ...registerDto, application: { ...details, emergency_rate: 10 } } as never),
      ).rejects.toMatchObject({ code: 'INVALID_RATES' });
      expect(tx.user.create).not.toHaveBeenCalled();
    });

    it('rejects duplicate and unknown skills', async () => {
      const { service, prisma } = setup();
      const dup = { ...details, skills: [details.skills[0], details.skills[0]] };
      await expect(service.registerApplicant({ ...registerDto, application: dup } as never)).rejects.toMatchObject({
        code: 'DUPLICATE_SKILLS',
      });
      prisma.skill.count.mockResolvedValue(1);
      await expect(service.registerApplicant(registerDto as never)).rejects.toMatchObject({ code: 'UNKNOWN_SKILL' });
    });

    it('maps a unique violation to EMAIL_TAKEN or PHONE_TAKEN', async () => {
      const { service, tx } = setup();
      tx.user.create.mockRejectedValueOnce(uniqueError(['email']));
      await expect(service.registerApplicant(registerDto as never)).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
      tx.user.create.mockRejectedValueOnce(uniqueError(['phone']));
      await expect(service.registerApplicant(registerDto as never)).rejects.toMatchObject({ code: 'PHONE_TAKEN' });
    });
  });

  describe('reapply', () => {
    it('moves a REJECTED profile back to PENDING_REVIEW with a new application and replaced skills', async () => {
      const { service, prisma, tx, audit } = setup();
      prisma.technicianProfile.findUnique.mockResolvedValue({ id: 'p1' });
      tx.technicianProfile.updateMany.mockResolvedValue({ count: 1 });
      tx.technicianTierRequest.create.mockResolvedValue({ id: 'app2' });

      const result = await service.reapply(technician, details as never);

      expect(tx.technicianProfile.updateMany.mock.calls[0][0].where).toEqual({
        id: 'p1',
        profile_status: ProfileStatus.REJECTED,
      });
      expect(tx.technicianSkill.deleteMany).toHaveBeenCalledWith({ where: { technician_profile_id: 'p1' } });
      expect(tx.technicianSkill.createMany.mock.calls[0][0].data).toHaveLength(2);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ actorId: technician.id }), tx);
      expect(result).toEqual({ application_id: 'app2', status: TierRequestStatus.PENDING });
    });

    it('refuses when the profile is not REJECTED', async () => {
      const { service, prisma, tx } = setup();
      prisma.technicianProfile.findUnique.mockResolvedValue({ id: 'p1' });
      tx.technicianProfile.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.reapply(technician, details as never)).rejects.toMatchObject({ code: 'NOT_REJECTED' });
      expect(tx.technicianTierRequest.create).not.toHaveBeenCalled();
    });

    it('404s for a user without a technician profile', async () => {
      const { service, prisma } = setup();
      prisma.technicianProfile.findUnique.mockResolvedValue(null);
      await expect(service.reapply(technician, details as never)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('decide', () => {
    const pending = {
      id: 'app1',
      request_type: TierRequestType.INITIAL_APPLICATION,
      technician_profile_id: 'p1',
      proposed_tier_id: null,
    };

    function stubGet(service: TechniciansService) {
      jest.spyOn(service, 'get').mockResolvedValue({ id: 'app1' } as never);
    }

    it('approves: sets APPROVED, grants BRONZE by default, audits TECHNICIAN_APPROVED', async () => {
      const { service, prisma, tx, audit } = setup();
      stubGet(service);
      prisma.technicianTierRequest.findUnique.mockResolvedValue(pending);
      prisma.commissionTier.findUnique.mockResolvedValue({ id: 'tier-bronze', name: 'BRONZE' });
      tx.technicianTierRequest.updateMany.mockResolvedValue({ count: 1 });
      tx.technicianProfile.update.mockResolvedValue({
        id: 'p1',
        profile_status: ProfileStatus.APPROVED,
        normal_rate: new Prisma.Decimal(28),
        emergency_rate: new Prisma.Decimal(50),
      });

      await service.decide('app1', manager, { decision: 'APPROVED', normal_rate: 28 });

      expect(prisma.commissionTier.findUnique).toHaveBeenCalledWith({ where: { name: 'BRONZE' } });
      expect(tx.technicianTierRequest.updateMany.mock.calls[0][0].data).toMatchObject({
        status: TierRequestStatus.APPROVED,
        final_tier_id: 'tier-bronze',
        reviewed_by: manager.id,
      });
      expect(tx.technicianProfile.update.mock.calls[0][0].data).toMatchObject({
        profile_status: ProfileStatus.APPROVED,
        current_tier_id: 'tier-bronze',
        normal_rate: 28,
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.TECHNICIAN_APPROVED, actorId: manager.id }),
        tx,
      );
    });

    it('rejects: sets REJECTED, no tier, audits TECHNICIAN_REJECTED, keeps the reason', async () => {
      const { service, prisma, tx, audit } = setup();
      stubGet(service);
      prisma.technicianTierRequest.findUnique.mockResolvedValue(pending);
      tx.technicianTierRequest.updateMany.mockResolvedValue({ count: 1 });
      tx.technicianProfile.update.mockResolvedValue({
        id: 'p1',
        profile_status: ProfileStatus.REJECTED,
        normal_rate: new Prisma.Decimal(30),
        emergency_rate: new Prisma.Decimal(50),
      });

      await service.decide('app1', manager, { decision: 'REJECTED', review_notes: 'Missing certificate' });

      expect(prisma.commissionTier.findUnique).not.toHaveBeenCalled();
      expect(tx.technicianTierRequest.updateMany.mock.calls[0][0].data).toMatchObject({
        status: TierRequestStatus.REJECTED,
        final_tier_id: null,
        review_notes: 'Missing certificate',
      });
      expect(tx.technicianProfile.update.mock.calls[0][0].data.profile_status).toBe(ProfileStatus.REJECTED);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.TECHNICIAN_REJECTED }), tx);
    });

    it('409s when the application was already decided', async () => {
      const { service, prisma, tx } = setup();
      prisma.technicianTierRequest.findUnique.mockResolvedValue(pending);
      prisma.commissionTier.findUnique.mockResolvedValue({ id: 'tier-bronze' });
      tx.technicianTierRequest.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.decide('app1', manager, { decision: 'APPROVED' })).rejects.toMatchObject({
        code: 'ALREADY_DECIDED',
      });
      expect(tx.technicianProfile.update).not.toHaveBeenCalled();
    });

    it('refuses tier-update requests and unknown ids', async () => {
      const { service, prisma } = setup();
      prisma.technicianTierRequest.findUnique.mockResolvedValueOnce({ ...pending, request_type: TierRequestType.TIER_UPDATE });
      await expect(service.decide('app1', manager, { decision: 'APPROVED' })).rejects.toMatchObject({
        code: 'NOT_AN_APPLICATION',
      });
      prisma.technicianTierRequest.findUnique.mockResolvedValueOnce(null);
      await expect(service.decide('nope', manager, { decision: 'APPROVED' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('fails when the commission tier is not configured', async () => {
      const { service, prisma } = setup();
      prisma.technicianTierRequest.findUnique.mockResolvedValue(pending);
      prisma.commissionTier.findUnique.mockResolvedValue(null);
      await expect(service.decide('app1', manager, { decision: 'APPROVED' })).rejects.toMatchObject({
        code: 'TIER_NOT_CONFIGURED',
      });
    });
  });

  describe('getProfileStatus', () => {
    it('returns the status, or null for users without a technician profile', async () => {
      const { service, prisma } = setup();
      prisma.technicianProfile.findUnique.mockResolvedValueOnce({ profile_status: ProfileStatus.PENDING_REVIEW });
      expect(await service.getProfileStatus('u1')).toBe(ProfileStatus.PENDING_REVIEW);
      prisma.technicianProfile.findUnique.mockResolvedValueOnce(null);
      expect(await service.getProfileStatus('u2')).toBeNull();
    });
  });
});
