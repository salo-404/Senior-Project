/**
 * Checks, before any test runs, whether the Docker Redis and object storage from docker-compose are reachable,
 * and tells the smoke tests through environment variables. The smoke tests skip (with a clear message printed
 * here) when a service is not running; they never fail because of it.
 *
 * Start them with:  docker compose up -d redis storage
 * Storage credentials come from E2E_SMOKE_STORAGE_ACCESS_KEY / E2E_SMOKE_STORAGE_SECRET_KEY, or from
 * STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY in the repository's root .env (the file docker-compose reads).
 * They are only used to talk to the local container and are never printed.
 */
import { HeadBucketCommand, ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';

export const SMOKE_REDIS_URL = process.env.E2E_SMOKE_REDIS_URL ?? 'redis://127.0.0.1:6379';
export const SMOKE_STORAGE_ENDPOINT = process.env.E2E_SMOKE_STORAGE_ENDPOINT ?? 'http://127.0.0.1:9000';

function rootEnvValue(name: string): string | undefined {
  try {
    const file = readFileSync(join(__dirname, '..', '..', '..', '.env'), 'utf8');
    const line = file.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') || undefined;
  } catch {
    return undefined;
  }
}

export function storageCredentials(): { accessKey: string; secretKey: string } | null {
  const accessKey = process.env.E2E_SMOKE_STORAGE_ACCESS_KEY ?? process.env.STORAGE_ACCESS_KEY ?? rootEnvValue('STORAGE_ACCESS_KEY');
  const secretKey = process.env.E2E_SMOKE_STORAGE_SECRET_KEY ?? process.env.STORAGE_SECRET_KEY ?? rootEnvValue('STORAGE_SECRET_KEY');
  return accessKey && secretKey ? { accessKey, secretKey } : null;
}

function tcpOpen(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export async function probeRedis(): Promise<boolean> {
  const url = new URL(SMOKE_REDIS_URL);
  return tcpOpen(url.hostname, Number(url.port || 6379));
}

export async function probeStorage(): Promise<boolean> {
  const creds = storageCredentials();
  if (!creds) return false;
  const s3 = new S3Client({
    region: 'us-east-1',
    endpoint: SMOKE_STORAGE_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: creds.accessKey, secretAccessKey: creds.secretKey },
    maxAttempts: 1,
  });
  try {
    await s3.send(new ListBucketsCommand({}), { abortSignal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  } finally {
    s3.destroy();
  }
}

export { HeadBucketCommand };
