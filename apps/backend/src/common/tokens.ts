import { createHash, randomBytes } from 'node:crypto';

/** A random one-time token, safe to put in a URL. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are stored only as this hash. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
