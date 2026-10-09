import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs `fn` in one database transaction and passes it `tx`. Services accept an optional `tx`,
   * so several modules can write in the same transaction.
   */
  runInTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    // Prisma closes an interactive transaction after 5 s by default. A far-away database (e.g. a hosted
    // Neon server) can need longer; set DB_TRANSACTION_TIMEOUT_MS to raise it. Unset keeps Prisma's default.
    const timeout = Number(process.env.DB_TRANSACTION_TIMEOUT_MS);
    return this.$transaction((tx) => fn(tx), timeout > 0 ? { timeout, maxWait: timeout } : undefined);
  }
}
