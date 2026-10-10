/**
 * Runs before every e2e test file. All e2e files share one throwaway database, and most of them create test
 * users with the same emails (custA@test.dev, dispatcher@test.dev, ...). Without this reset, the second file to
 * run fails with "Unique constraint failed on the fields: (email)". Emptying every table first makes each file
 * independent of the others and of the order they run in.
 *
 * TRUNCATE is allowed on audit_logs: the immutability trigger only blocks row-level UPDATE and DELETE.
 * The Prisma migrations table is kept, and no migration inserts data, so there is nothing else to restore.
 */
import { PrismaClient } from '@prisma/client';

beforeAll(async () => {
  const url = process.env.E2E_DATABASE_URL;
  if (!url || !/\/maintain_e2e_[0-9a-f]+/.test(url)) {
    // Never truncate anything that is not the throwaway database created by global-setup.
    throw new Error('Refusing to clean a database that is not a maintain_e2e_* throwaway database.');
  }
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    if (tables.length > 0) {
      const list = tables.map((t) => `"${t.tablename}"`).join(', ');
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await prisma.$disconnect();
  }
});
