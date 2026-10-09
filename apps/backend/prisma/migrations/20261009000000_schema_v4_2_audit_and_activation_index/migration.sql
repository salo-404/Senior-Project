-- Schema v4.2: security-relevant audit actions and a unique index for the activation-token lookup.
-- Note: `prisma migrate diff` also proposes DROP INDEX "knowledge_chunks_embedding_hnsw"
-- (Prisma cannot model the HNSW index). It is intentionally NOT dropped here.

-- AlterEnum (each value in its own statement)
ALTER TYPE "audit_action" ADD VALUE 'USER_ROLE_CHANGED';

ALTER TYPE "audit_action" ADD VALUE 'ACCOUNT_ACTIVATED';

ALTER TYPE "audit_action" ADD VALUE 'ATTACHMENT_DELETED';

-- CreateIndex
CREATE UNIQUE INDEX "users_activation_token_hash_key" ON "users"("activation_token_hash");
