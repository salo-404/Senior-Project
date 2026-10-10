-- Schema v4.3: audit action for dispatcher edits of a case.
-- Note: `prisma migrate diff` also proposes DROP INDEX "knowledge_chunks_embedding_hnsw"
-- (Prisma cannot model the HNSW index). It is intentionally NOT dropped here.

-- AlterEnum
ALTER TYPE "audit_action" ADD VALUE 'CASE_UPDATED';
