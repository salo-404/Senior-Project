import { NotFoundException } from '@nestjs/common';
import { MaintenanceCategory, Prisma, ProfileStatus } from '@prisma/client';
import { CatalogService } from './catalog.service';

const uniqueError = new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test', meta: { target: ['name'] } });

function setup() {
  const prisma = {
    skill: { create: jest.fn() },
    team: { create: jest.fn(), findUnique: jest.fn() },
    teamMember: { create: jest.fn() },
    technicianProfile: { findUnique: jest.fn() },
  };
  return { service: new CatalogService(prisma as never), prisma };
}

describe('CatalogService', () => {
  it('creates a skill and trims its name', async () => {
    const { service, prisma } = setup();
    prisma.skill.create.mockResolvedValue({ id: 's1' });
    await service.createSkill({ name: '  Duct cleaning ', category: MaintenanceCategory.HVAC });
    expect(prisma.skill.create).toHaveBeenCalledWith({
      data: { name: 'Duct cleaning', category: MaintenanceCategory.HVAC, description: undefined },
    });
  });

  it('reports a duplicate skill name as 409 SKILL_EXISTS, and rethrows other errors', async () => {
    const { service, prisma } = setup();
    prisma.skill.create.mockRejectedValue(uniqueError);
    await expect(service.createSkill({ name: 'AC repair', category: MaintenanceCategory.HVAC })).rejects.toMatchObject({
      code: 'SKILL_EXISTS',
      status: 409,
    });
    prisma.skill.create.mockRejectedValue(new Error('db down'));
    await expect(service.createSkill({ name: 'AC repair', category: MaintenanceCategory.HVAC })).rejects.toThrow('db down');
  });

  it('creates a team', async () => {
    const { service, prisma } = setup();
    prisma.team.create.mockResolvedValue({ id: 't1' });
    await service.createTeam({ name: ' North crew ', category: MaintenanceCategory.HOME_APPLIANCES, description: 'Beirut north' });
    expect(prisma.team.create).toHaveBeenCalledWith({
      data: { name: 'North crew', category: MaintenanceCategory.HOME_APPLIANCES, description: 'Beirut north' },
    });
  });

  describe('addTeamMember', () => {
    it('adds an approved technician using their user id', async () => {
      const { service, prisma } = setup();
      prisma.team.findUnique.mockResolvedValue({ id: 't1' });
      prisma.technicianProfile.findUnique.mockResolvedValue({ profile_status: ProfileStatus.APPROVED });
      prisma.teamMember.create.mockResolvedValue({ team_id: 't1', user_id: 'u1' });
      await service.addTeamMember('t1', { user_id: 'u1', role_in_team: 'Lead' });
      expect(prisma.teamMember.create).toHaveBeenCalledWith({ data: { team_id: 't1', user_id: 'u1', role_in_team: 'Lead' } });
    });

    it('404s for an unknown team or a user who is not a technician', async () => {
      const { service, prisma } = setup();
      prisma.team.findUnique.mockResolvedValue(null);
      await expect(service.addTeamMember('nope', { user_id: 'u1' })).rejects.toBeInstanceOf(NotFoundException);

      prisma.team.findUnique.mockResolvedValue({ id: 't1' });
      prisma.technicianProfile.findUnique.mockResolvedValue(null);
      await expect(service.addTeamMember('t1', { user_id: 'customer-1' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([ProfileStatus.PENDING_REVIEW, ProfileStatus.REJECTED])('refuses a %s technician', async (status) => {
      const { service, prisma } = setup();
      prisma.team.findUnique.mockResolvedValue({ id: 't1' });
      prisma.technicianProfile.findUnique.mockResolvedValue({ profile_status: status });
      await expect(service.addTeamMember('t1', { user_id: 'u1' })).rejects.toMatchObject({ code: 'NOT_APPROVED' });
      expect(prisma.teamMember.create).not.toHaveBeenCalled();
    });

    it('reports a technician who is already in the team as 409', async () => {
      const { service, prisma } = setup();
      prisma.team.findUnique.mockResolvedValue({ id: 't1' });
      prisma.technicianProfile.findUnique.mockResolvedValue({ profile_status: ProfileStatus.APPROVED });
      prisma.teamMember.create.mockRejectedValue(uniqueError);
      await expect(service.addTeamMember('t1', { user_id: 'u1' })).rejects.toMatchObject({ code: 'ALREADY_MEMBER' });
    });
  });
});
