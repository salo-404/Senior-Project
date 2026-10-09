import { Injectable } from '@nestjs/common';
import type { ProfileStatus } from '@prisma/client';

/**
 * Auth must not read technician_profiles (the technicians module owns that table).
 * This port is what the technicians module will implement in week 2.
 * TODO(week 2): provide a TechniciansService-backed implementation and drop the default below.
 */
export abstract class TechnicianProfileStatusPort {
  /** The technician's profile status, or null when the user has no technician profile. */
  abstract getStatus(userId: string): Promise<ProfileStatus | null>;
}

@Injectable()
export class NoTechnicianProfileStatus extends TechnicianProfileStatusPort {
  async getStatus(): Promise<ProfileStatus | null> {
    return null;
  }
}
