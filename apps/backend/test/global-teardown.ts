import { PrismaClient } from '@prisma/client';

/** Drops the throwaway database created by global-setup. */
export default async function globalTeardown(): Promise<void> {
  const adminUrl = process.env.E2E_ADMIN_URL;
  const dbName = process.env.E2E_DB_NAME;
  if (!adminUrl || !dbName || !/^maintain_e2e_[0-9a-f]+$/.test(dbName)) return;

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  } finally {
    await admin.$disconnect();
  }
}
