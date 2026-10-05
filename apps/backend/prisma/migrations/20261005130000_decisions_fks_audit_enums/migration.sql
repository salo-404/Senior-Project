-- Decisions migration: snake_case enum types, timestamptz, actor foreign keys, AI tool-call audit, nullable contact_preference

-- Part 1: data-preserving renames (enum types to snake_case, timestamps to timestamptz)

ALTER TYPE "Role" RENAME TO "role";
ALTER TYPE "MaintenanceCategory" RENAME TO "maintenance_category";
ALTER TYPE "RequestPriority" RENAME TO "request_priority";
ALTER TYPE "RequestStatus" RENAME TO "request_status";
ALTER TYPE "AiAnalysisStatus" RENAME TO "ai_analysis_status";
ALTER TYPE "AssignmentStatus" RENAME TO "assignment_status";
ALTER TYPE "ProfileStatus" RENAME TO "profile_status";
ALTER TYPE "TierRequestType" RENAME TO "tier_request_type";
ALTER TYPE "TierRequestStatus" RENAME TO "tier_request_status";
ALTER TYPE "TierDecisionOutcome" RENAME TO "tier_decision_outcome";
ALTER TYPE "CommissionTierName" RENAME TO "commission_tier_name";
ALTER TYPE "LedgerEntryType" RENAME TO "ledger_entry_type";
ALTER TYPE "InvoiceStatus" RENAME TO "invoice_status";
ALTER TYPE "PaymentStatus" RENAME TO "payment_status";
ALTER TYPE "PaymentMethod" RENAME TO "payment_method";
ALTER TYPE "AttachmentPurpose" RENAME TO "attachment_purpose";
ALTER TYPE "KnowledgeSourceType" RENAME TO "knowledge_source_type";
ALTER TYPE "ProcessingStatus" RENAME TO "processing_status";
ALTER TYPE "AiAgentType" RENAME TO "ai_agent_type";
ALTER TYPE "CaseSource" RENAME TO "case_source";
ALTER TYPE "ContactPreference" RENAME TO "contact_preference";
ALTER TYPE "UrgencyLevel" RENAME TO "urgency_level";
ALTER TYPE "RateType" RENAME TO "rate_type";
ALTER TYPE "AiRunStatus" RENAME TO "ai_run_status";
ALTER TYPE "NotificationType" RENAME TO "notification_type";
ALTER TYPE "NotificationPriority" RENAME TO "notification_priority";
ALTER TYPE "AuditAction" RENAME TO "audit_action";

ALTER TABLE "users" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "users" ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "user_roles" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "refresh_tokens" ALTER COLUMN "expires_at" TYPE TIMESTAMPTZ(3) USING "expires_at" AT TIME ZONE 'UTC';
ALTER TABLE "refresh_tokens" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "customer_profiles" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "customer_profiles" ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "technician_profiles" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "technician_profiles" ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "technician_tier_requests" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "technician_tier_requests" ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "teams" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "team_members" ALTER COLUMN "joined_at" TYPE TIMESTAMPTZ(3) USING "joined_at" AT TIME ZONE 'UTC';
ALTER TABLE "addresses" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "equipment" ALTER COLUMN "installation_date" TYPE TIMESTAMPTZ(3) USING "installation_date" AT TIME ZONE 'UTC';
ALTER TABLE "equipment" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "equipment" ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "maintenance_requests" ALTER COLUMN "escalated_at" TYPE TIMESTAMPTZ(3) USING "escalated_at" AT TIME ZONE 'UTC';
ALTER TABLE "maintenance_requests" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "maintenance_requests" ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "maintenance_cases" ALTER COLUMN "verified_at" TYPE TIMESTAMPTZ(3) USING "verified_at" AT TIME ZONE 'UTC';
ALTER TABLE "maintenance_cases" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "maintenance_cases" ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "request_status_history" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "ai_conversations" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "ai_conversations" ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "ai_runs" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "assignments" ALTER COLUMN "scheduled_at" TYPE TIMESTAMPTZ(3) USING "scheduled_at" AT TIME ZONE 'UTC';
ALTER TABLE "assignments" ALTER COLUMN "accepted_at" TYPE TIMESTAMPTZ(3) USING "accepted_at" AT TIME ZONE 'UTC';
ALTER TABLE "assignments" ALTER COLUMN "started_at" TYPE TIMESTAMPTZ(3) USING "started_at" AT TIME ZONE 'UTC';
ALTER TABLE "assignments" ALTER COLUMN "expected_return_at" TYPE TIMESTAMPTZ(3) USING "expected_return_at" AT TIME ZONE 'UTC';
ALTER TABLE "assignments" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "assignments" ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "job_reports" ALTER COLUMN "submitted_at" TYPE TIMESTAMPTZ(3) USING "submitted_at" AT TIME ZONE 'UTC';
ALTER TABLE "job_reports" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "job_costs" ALTER COLUMN "customer_confirmed_at" TYPE TIMESTAMPTZ(3) USING "customer_confirmed_at" AT TIME ZONE 'UTC';
ALTER TABLE "job_costs" ALTER COLUMN "invoice_submitted_at" TYPE TIMESTAMPTZ(3) USING "invoice_submitted_at" AT TIME ZONE 'UTC';
ALTER TABLE "job_costs" ALTER COLUMN "payment_confirmed_at" TYPE TIMESTAMPTZ(3) USING "payment_confirmed_at" AT TIME ZONE 'UTC';
ALTER TABLE "job_costs" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "job_costs" ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "reviews" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "ai_feedback" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "case_feedback" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "notifications" ALTER COLUMN "read_at" TYPE TIMESTAMPTZ(3) USING "read_at" AT TIME ZONE 'UTC';
ALTER TABLE "notifications" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "audit_logs" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "attachments" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "knowledge_sources" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "knowledge_documents" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "knowledge_documents" ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "knowledge_chunks" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "commission_tiers" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "commission_tiers" ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "technician_ledger" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- Part 2: schema changes
-- CreateEnum
CREATE TYPE "tool_call_status" AS ENUM ('SUCCESS', 'FAILED', 'UNAUTHORIZED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'LOGIN';
ALTER TYPE "audit_action" ADD VALUE 'LOGIN_FAILED';
ALTER TYPE "audit_action" ADD VALUE 'LOGOUT';
ALTER TYPE "audit_action" ADD VALUE 'AI_TOOL_CALL';

-- DropIndex

-- AlterTable
ALTER TABLE "ai_runs" ADD COLUMN     "correlation_id" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD COLUMN     "idempotency_key" TEXT;

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "correlation_id" UUID;

-- AlterTable
ALTER TABLE "maintenance_requests" ALTER COLUMN "contact_preference" DROP NOT NULL,
ALTER COLUMN "contact_preference" DROP DEFAULT;

-- CreateTable
CREATE TABLE "ai_tool_calls" (
    "id" TEXT NOT NULL,
    "ai_run_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "status" "tool_call_status" NOT NULL,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_tool_calls_ai_run_id_idx" ON "ai_tool_calls"("ai_run_id");

-- AddForeignKey
ALTER TABLE "technician_tier_requests" ADD CONSTRAINT "technician_tier_requests_proposed_tier_id_fkey" FOREIGN KEY ("proposed_tier_id") REFERENCES "commission_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician_tier_requests" ADD CONSTRAINT "technician_tier_requests_final_tier_id_fkey" FOREIGN KEY ("final_tier_id") REFERENCES "commission_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician_tier_requests" ADD CONSTRAINT "technician_tier_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_cases" ADD CONSTRAINT "maintenance_cases_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_costs" ADD CONSTRAINT "job_costs_confirmed_on_behalf_by_fkey" FOREIGN KEY ("confirmed_on_behalf_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_costs" ADD CONSTRAINT "job_costs_invoice_submitted_by_fkey" FOREIGN KEY ("invoice_submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_costs" ADD CONSTRAINT "job_costs_payment_confirmed_by_fkey" FOREIGN KEY ("payment_confirmed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_tool_calls" ADD CONSTRAINT "ai_tool_calls_ai_run_id_fkey" FOREIGN KEY ("ai_run_id") REFERENCES "ai_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_feedback" ADD CONSTRAINT "case_feedback_dispatcher_id_fkey" FOREIGN KEY ("dispatcher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "maintenance_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician_ledger" ADD CONSTRAINT "technician_ledger_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Part 3: raw SQL Prisma cannot express
-- One commission charge per job (commission is charged only when payment is confirmed)
CREATE UNIQUE INDEX technician_ledger_one_commission_per_job
  ON technician_ledger (job_cost_id)
  WHERE entry_type = 'COMMISSION_CHARGE';

-- Every attachment has exactly one parent
ALTER TABLE attachments
  ADD CONSTRAINT attachments_one_parent_check CHECK (
    (CASE WHEN request_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN job_report_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN conversation_id IS NOT NULL THEN 1 ELSE 0 END) = 1
  );

-- One in-flight AI run per idempotency key
CREATE UNIQUE INDEX ai_runs_one_inflight_per_key
  ON ai_runs (idempotency_key)
  WHERE idempotency_key IS NOT NULL AND status IN ('PENDING', 'IN_PROGRESS');
