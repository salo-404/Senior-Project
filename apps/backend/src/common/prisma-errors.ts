import { Prisma } from '@prisma/client';

/** Returns the violated column names when `err` is a unique-constraint error, otherwise null. */
export function uniqueViolationFields(err: unknown): string[] | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const target = err.meta?.target;
    if (Array.isArray(target)) return target.map(String);
    if (typeof target === 'string') return [target];
    return [];
  }
  return null;
}
