import type { Role } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  roles: Role[];
}
