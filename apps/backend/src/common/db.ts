import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../infra/prisma/prisma.service';

/** Either the shared client or a transaction client. Services accept an optional `tx` of this type. */
export type Db = PrismaService | Prisma.TransactionClient;
