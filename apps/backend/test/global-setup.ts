/**
 * Creates a throwaway database, applies the migrations to it, and points the tests at it.
 * The dev database is never touched. The admin connection comes from E2E_ADMIN_DATABASE_URL, or from
 * DATABASE_URL in apps/backend/.env (same server, different database name).
 */
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function baseUrl(): URL {
  let raw = process.env.E2E_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!raw) {
    const envFile = readFileSync(join(__dirname, '..', '.env'), 'utf8');
    const line = envFile.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
    if (!line) throw new Error('Set E2E_ADMIN_DATABASE_URL (or DATABASE_URL) to a Postgres server the tests may use.');
    raw = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
  }
  const url = new URL(raw);
  url.search = '';
  return url;
}

export default async function globalSetup(): Promise<void> {
  const base = baseUrl();
  const dbName = `maintain_e2e_${randomBytes(4).toString('hex')}`;

  const adminUrl = new URL(base.toString());
  adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.$disconnect();
  }

  const testUrl = new URL(base.toString());
  testUrl.pathname = `/${dbName}`;
  testUrl.searchParams.set('schema', 'public');

  execSync('npx prisma migrate deploy', {
    cwd: join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: 'pipe',
  });

  // Inherited by the test workers, which start after global setup.
  process.env.E2E_DATABASE_URL = testUrl.toString();
  process.env.E2E_ADMIN_URL = adminUrl.toString();
  process.env.E2E_DB_NAME = dbName;
}
