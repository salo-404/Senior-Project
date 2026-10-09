/**
 * Creates the first manager. Dispatchers and later managers are created by a manager through POST /api/v1/users.
 *
 *   SEED_MANAGER_EMAIL=... SEED_MANAGER_PASSWORD=... npm run seed
 *
 * The credentials come from the environment only (never hardcoded). Idempotent: running it again changes nothing.
 * Commission tiers, skills and equipment types are NOT seeded here.
 */
import 'dotenv/config';
import { AuditAction, PrismaClient, Role } from '@prisma/client';
import { hashPassword } from '../src/common/password';

const MIN_PASSWORD_LENGTH = 12;

async function main(): Promise<void> {
  const email = process.env.SEED_MANAGER_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_MANAGER_PASSWORD;

  if (!email || !password) {
    throw new Error('SEED_MANAGER_EMAIL and SEED_MANAGER_PASSWORD must both be set. Refusing to seed.');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('SEED_MANAGER_EMAIL is not a valid email address.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SEED_MANAGER_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, is_active: true, roles: { select: { role: true } } },
    });

    if (existing) {
      if (existing.roles.some((r) => r.role === Role.MANAGER)) {
        console.log(`Manager ${email} already exists. Nothing to do.`);
        return;
      }
      throw new Error(`A user with email ${email} already exists but is not a manager. Refusing to change it.`);
    }

    const passwordHash = await hashPassword(password);
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          password_hash: passwordHash,
          first_name: 'Manager',
          last_name: 'Account',
          is_active: true,
          roles: { create: { role: Role.MANAGER } },
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          user_id: null,
          action: AuditAction.USER_CREATED,
          entity_type: 'user',
          entity_id: user.id,
          new_value: { role: Role.MANAGER, seeded: true },
        },
      });
    });
    console.log(`Created manager ${email}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
