-- Schema v4.1: invite-only staff activation and customer-confirmed case summary.
-- Note: `prisma migrate diff` also proposes DROP INDEX "knowledge_chunks_embedding_hnsw"
-- (Prisma cannot model the HNSW index). It is intentionally NOT dropped here.

-- AlterEnum
ALTER TYPE "audit_action" ADD VALUE 'CASE_CONFIRMED_BY_CUSTOMER';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "activation_expires_at" TIMESTAMPTZ,
ADD COLUMN     "activation_token_hash" TEXT;

-- AlterTable
ALTER TABLE "maintenance_cases" ADD COLUMN     "customer_confirmed_at" TIMESTAMPTZ,
ADD COLUMN     "customer_note" TEXT;
