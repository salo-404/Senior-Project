-- Schema v4 fixes.
-- Note: `prisma migrate diff` also proposes DROP INDEX "knowledge_chunks_embedding_hnsw"
-- because Prisma cannot model the HNSW index. It is intentionally NOT dropped here.

-- Commission rate precision: Decimal(3,2) -> Decimal(5,2). Widening only, no data loss.
-- AlterTable
ALTER TABLE "commission_tiers" ALTER COLUMN "commission_rate" SET DATA TYPE DECIMAL(5,2);

-- AlterTable
ALTER TABLE "technician_ledger" ALTER COLUMN "rate_applied" SET DATA TYPE DECIMAL(5,2);

-- Decimal(5,2) alone allows up to 999.99; cap rates below 100 (a percentage).
ALTER TABLE "commission_tiers" ADD CONSTRAINT "commission_tiers_rate_range_check" CHECK ("commission_rate" >= 0 AND "commission_rate" < 100);
ALTER TABLE "technician_ledger" ADD CONSTRAINT "technician_ledger_rate_applied_range_check" CHECK ("rate_applied" IS NULL OR ("rate_applied" >= 0 AND "rate_applied" < 100));

-- AlterTable
ALTER TABLE "job_costs" ADD COLUMN     "invoice_lines" JSONB,
ADD COLUMN     "is_visit_fee_only" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "maintenance_requests" ADD COLUMN     "customer_had_unpaid_balance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "language" TEXT;

-- AlterTable
ALTER TABLE "technician_profiles" ADD COLUMN     "weekly_schedule" JSONB;

-- CreateIndex
CREATE INDEX "job_costs_invoice_status_payment_status_idx" ON "job_costs"("invoice_status", "payment_status");

-- CreateIndex
CREATE INDEX "maintenance_requests_equipment_id_created_at_idx" ON "maintenance_requests"("equipment_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- notifications.request_id -> maintenance_requests.id is already ON DELETE SET NULL
-- (notifications_request_id_fkey in the init migration), so no SQL is needed for it.
