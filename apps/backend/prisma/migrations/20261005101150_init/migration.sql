-- Required before any vector column (reset drops it with the schema)
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CUSTOMER', 'DISPATCHER', 'TECHNICIAN', 'MANAGER');

-- CreateEnum
CREATE TYPE "MaintenanceCategory" AS ENUM ('HVAC', 'HOME_APPLIANCES');

-- CreateEnum
CREATE TYPE "RequestPriority" AS ENUM ('NORMAL', 'URGENT', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('NEW', 'UNDER_REVIEW', 'APPROVED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REQUIRES_FOLLOW_UP', 'REJECTED');

-- CreateEnum
CREATE TYPE "AiAnalysisStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProfileStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TierRequestType" AS ENUM ('INITIAL_APPLICATION', 'TIER_UPDATE');

-- CreateEnum
CREATE TYPE "TierRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TierDecisionOutcome" AS ENUM ('TIER_CHANGED', 'SKILLS_NOTED_ONLY', 'NO_CHANGE');

-- CreateEnum
CREATE TYPE "CommissionTierName" AS ENUM ('BRONZE', 'SILVER', 'GOLD');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('COMMISSION_CHARGE', 'PAYMENT_RECEIVED', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'INVOICE_SUBMITTED', 'CONFIRMED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "AttachmentPurpose" AS ENUM ('CUSTOMER_PHOTO', 'TECHNICIAN_PHOTO', 'INVOICE_PHOTO');

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('MANUAL', 'CASE_REPORT', 'GUIDELINE');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiAgentType" AS ENUM ('MAINTENANCE_INTELLIGENCE', 'OPERATIONS_INTELLIGENCE', 'ORCHESTRATOR');

-- CreateEnum
CREATE TYPE "CaseSource" AS ENUM ('AI', 'MANUAL');

-- CreateEnum
CREATE TYPE "ContactPreference" AS ENUM ('FORM', 'HOTLINE');

-- CreateEnum
CREATE TYPE "UrgencyLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RateType" AS ENUM ('NORMAL', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('REQUEST_SUBMITTED', 'REQUEST_STATUS_CHANGED', 'ASSIGNMENT_CREATED', 'ASSIGNMENT_ACCEPTED', 'JOB_STARTED', 'JOB_COMPLETED', 'INVOICE_SUBMITTED', 'PAYMENT_CONFIRMED', 'PAYMENT_DISPUTED', 'SAFETY_ESCALATED', 'COMMISSION_CHARGED', 'TIER_CHANGED', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED', 'PASSWORD_CHANGED', 'REQUEST_CREATED', 'REQUEST_STATUS_CHANGED', 'REQUEST_CANCELLED', 'CASE_VERIFIED', 'CASE_CREATED_MANUAL', 'ASSIGNMENT_CREATED', 'ASSIGNMENT_ACCEPTED', 'ASSIGNMENT_STARTED', 'ASSIGNMENT_REJECTED', 'ASSIGNMENT_CANCELLED', 'JOB_REPORT_SUBMITTED', 'INVOICE_CONFIRMED_BY_CUSTOMER', 'INVOICE_DISPUTED', 'INVOICE_CONFIRMED_ON_BEHALF', 'INVOICE_PHOTO_SUBMITTED', 'PAYMENT_CONFIRMED', 'PAYMENT_DISPUTED', 'TECHNICIAN_APPROVED', 'TECHNICIAN_REJECTED', 'TIER_CHANGED', 'COMMISSION_CHARGED', 'COMMISSION_PAYMENT_RECORDED', 'KNOWLEDGE_PROMOTED', 'SAFETY_ESCALATED', 'EMERGENCY_DOWNGRADED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "has_unpaid_balance" BOOLEAN NOT NULL DEFAULT false,
    "unpaid_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technician_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "bio" TEXT,
    "years_of_experience" INTEGER NOT NULL DEFAULT 0,
    "rating" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "total_reviews" INTEGER NOT NULL DEFAULT 0,
    "profile_status" "ProfileStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "current_tier_id" TEXT,
    "outstanding_balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "is_payment_blocked" BOOLEAN NOT NULL DEFAULT false,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "normal_rate" DECIMAL(10,2) NOT NULL,
    "emergency_rate" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "technician_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technician_tier_requests" (
    "id" TEXT NOT NULL,
    "technician_profile_id" TEXT NOT NULL,
    "request_type" "TierRequestType" NOT NULL,
    "proposed_tier_id" TEXT,
    "supporting_notes" TEXT,
    "status" "TierRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decision_outcome" "TierDecisionOutcome",
    "final_tier_id" TEXT,
    "reviewed_by" TEXT,
    "review_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "technician_tier_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "MaintenanceCategory" NOT NULL,
    "description" TEXT,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "MaintenanceCategory" NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technician_skills" (
    "technician_profile_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "proficiency_level" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "technician_skills_pkey" PRIMARY KEY ("technician_profile_id","skill_id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "team_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_in_team" TEXT,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("team_id","user_id")
);

-- CreateTable
CREATE TABLE "equipment_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "MaintenanceCategory" NOT NULL,
    "description" TEXT,

    CONSTRAINT "equipment_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "label" TEXT,
    "street" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT,
    "floor" TEXT,
    "building" TEXT,
    "notes" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "equipment_type_id" TEXT NOT NULL,
    "address_id" TEXT,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "serial_number" TEXT,
    "installation_date" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_requests" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "address_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "RequestPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "RequestStatus" NOT NULL DEFAULT 'NEW',
    "ai_analysis_status" "AiAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "problem_type" TEXT,
    "intake_answers" JSONB,
    "is_safety_escalated" BOOLEAN NOT NULL DEFAULT false,
    "escalated_at" TIMESTAMP(3),
    "escalation_reason" TEXT,
    "rejection_reason" TEXT,
    "cancellation_reason" TEXT,
    "cancelled_by" TEXT,
    "contact_preference" "ContactPreference" NOT NULL DEFAULT 'FORM',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_cases" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "source" "CaseSource" NOT NULL,
    "summary" TEXT,
    "urgency_level" "UrgencyLevel",
    "safety_flags" JSONB,
    "symptoms" JSONB,
    "follow_up_questions" JSONB,
    "possible_causes" JSONB,
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_status_history" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "from_status" "RequestStatus",
    "to_status" "RequestStatus" NOT NULL,
    "changed_by" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" TEXT NOT NULL,
    "request_id" TEXT,
    "user_id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "messages" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "request_id" TEXT,
    "agent_type" "AiAgentType" NOT NULL,
    "model_name" TEXT,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "latency_ms" INTEGER,
    "status" "AiRunStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "technician_profile_id" TEXT,
    "is_external" BOOLEAN NOT NULL DEFAULT false,
    "external_name" TEXT,
    "external_phone" TEXT,
    "assigned_by" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "delay_reason" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "expected_return_at" TIMESTAMP(3),
    "visit_count" INTEGER NOT NULL DEFAULT 1,
    "ranking_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_reports" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "diagnosis" TEXT,
    "work_done" TEXT,
    "parts_used" JSONB,
    "ai_analysis_was_helpful" BOOLEAN,
    "notes" TEXT,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_costs" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "hours_worked" DECIMAL(6,2),
    "hourly_rate_used" DECIMAL(10,2),
    "rate_type" "RateType",
    "extra_visits" INTEGER NOT NULL DEFAULT 0,
    "manual_labor_cost" DECIMAL(10,2),
    "parts_cost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "labor_cost" DECIMAL(10,2) NOT NULL,
    "total_cost" DECIMAL(10,2) NOT NULL,
    "invoice_status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "customer_confirmed_at" TIMESTAMP(3),
    "confirmed_on_behalf_by" TEXT,
    "dispute_reason" TEXT,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "payment_method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "invoice_submitted_at" TIMESTAMP(3),
    "invoice_submitted_by" TEXT,
    "payment_confirmed_by" TEXT,
    "payment_confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "technician_profile_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_feedback" (
    "id" TEXT NOT NULL,
    "ai_run_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_feedback" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "dispatcher_id" TEXT NOT NULL,
    "is_accurate" BOOLEAN NOT NULL,
    "notes" TEXT,
    "approved_for_knowledge" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "notification_type" "NotificationType" NOT NULL,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "request_id" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" "AuditAction" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "request_id" TEXT,
    "job_report_id" TEXT,
    "conversation_id" TEXT,
    "purpose" "AttachmentPurpose" NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source_type" "KnowledgeSourceType" NOT NULL,
    "category" "MaintenanceCategory" NOT NULL,
    "file_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_job_report_id" TEXT,
    "content" TEXT NOT NULL,
    "processing_status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "total_chunks" INTEGER,
    "verified_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_tiers" (
    "id" TEXT NOT NULL,
    "name" "CommissionTierName" NOT NULL,
    "commission_rate" DECIMAL(3,2) NOT NULL,
    "min_rating" DECIMAL(3,2),
    "min_experience_years" INTEGER,
    "min_completed_jobs" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technician_ledger" (
    "id" TEXT NOT NULL,
    "technician_profile_id" TEXT NOT NULL,
    "entry_type" "LedgerEntryType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "balance_after" DECIMAL(10,2) NOT NULL,
    "job_cost_id" TEXT,
    "tier_id_at_charge" TEXT,
    "rate_applied" DECIMAL(3,2),
    "recorded_by" TEXT,
    "payment_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "technician_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_user_id_key" ON "customer_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "technician_profiles_user_id_key" ON "technician_profiles"("user_id");

-- CreateIndex
CREATE INDEX "technician_tier_requests_technician_profile_id_idx" ON "technician_tier_requests"("technician_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "skills_name_key" ON "skills"("name");

-- CreateIndex
CREATE INDEX "addresses_user_id_idx" ON "addresses"("user_id");

-- CreateIndex
CREATE INDEX "equipment_user_id_idx" ON "equipment"("user_id");

-- CreateIndex
CREATE INDEX "maintenance_requests_customer_id_idx" ON "maintenance_requests"("customer_id");

-- CreateIndex
CREATE INDEX "maintenance_requests_status_idx" ON "maintenance_requests"("status");

-- CreateIndex
CREATE INDEX "maintenance_requests_priority_idx" ON "maintenance_requests"("priority");

-- CreateIndex
CREATE INDEX "maintenance_requests_ai_analysis_status_idx" ON "maintenance_requests"("ai_analysis_status");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_cases_request_id_key" ON "maintenance_cases"("request_id");

-- CreateIndex
CREATE INDEX "request_status_history_request_id_idx" ON "request_status_history"("request_id");

-- CreateIndex
CREATE INDEX "ai_conversations_user_id_idx" ON "ai_conversations"("user_id");

-- CreateIndex
CREATE INDEX "ai_runs_request_id_idx" ON "ai_runs"("request_id");

-- CreateIndex
CREATE INDEX "assignments_request_id_idx" ON "assignments"("request_id");

-- CreateIndex
CREATE INDEX "assignments_technician_profile_id_idx" ON "assignments"("technician_profile_id");

-- CreateIndex
CREATE INDEX "assignments_status_idx" ON "assignments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "job_reports_assignment_id_key" ON "job_reports"("assignment_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_costs_assignment_id_key" ON "job_costs"("assignment_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_request_id_key" ON "reviews"("request_id");

-- CreateIndex
CREATE INDEX "reviews_technician_profile_id_idx" ON "reviews"("technician_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_feedback_ai_run_id_user_id_key" ON "ai_feedback"("ai_run_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "case_feedback_case_id_key" ON "case_feedback"("case_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "attachments_request_id_idx" ON "attachments"("request_id");

-- CreateIndex
CREATE INDEX "attachments_job_report_id_idx" ON "attachments"("job_report_id");

-- CreateIndex
CREATE INDEX "knowledge_documents_source_id_idx" ON "knowledge_documents"("source_id");

-- CreateIndex
CREATE INDEX "knowledge_chunks_document_id_idx" ON "knowledge_chunks"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "commission_tiers_name_key" ON "commission_tiers"("name");

-- CreateIndex
CREATE INDEX "technician_ledger_technician_profile_id_idx" ON "technician_ledger"("technician_profile_id");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician_profiles" ADD CONSTRAINT "technician_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician_profiles" ADD CONSTRAINT "technician_profiles_current_tier_id_fkey" FOREIGN KEY ("current_tier_id") REFERENCES "commission_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician_tier_requests" ADD CONSTRAINT "technician_tier_requests_technician_profile_id_fkey" FOREIGN KEY ("technician_profile_id") REFERENCES "technician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician_skills" ADD CONSTRAINT "technician_skills_technician_profile_id_fkey" FOREIGN KEY ("technician_profile_id") REFERENCES "technician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician_skills" ADD CONSTRAINT "technician_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "technician_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_equipment_type_id_fkey" FOREIGN KEY ("equipment_type_id") REFERENCES "equipment_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_cases" ADD CONSTRAINT "maintenance_cases_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "maintenance_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "maintenance_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "maintenance_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "maintenance_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "maintenance_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_technician_profile_id_fkey" FOREIGN KEY ("technician_profile_id") REFERENCES "technician_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_reports" ADD CONSTRAINT "job_reports_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_costs" ADD CONSTRAINT "job_costs_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_technician_profile_id_fkey" FOREIGN KEY ("technician_profile_id") REFERENCES "technician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_ai_run_id_fkey" FOREIGN KEY ("ai_run_id") REFERENCES "ai_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_feedback" ADD CONSTRAINT "case_feedback_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "maintenance_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "maintenance_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_job_report_id_fkey" FOREIGN KEY ("job_report_id") REFERENCES "job_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_source_job_report_id_fkey" FOREIGN KEY ("source_job_report_id") REFERENCES "job_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician_ledger" ADD CONSTRAINT "technician_ledger_technician_profile_id_fkey" FOREIGN KEY ("technician_profile_id") REFERENCES "technician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician_ledger" ADD CONSTRAINT "technician_ledger_tier_id_at_charge_fkey" FOREIGN KEY ("tier_id_at_charge") REFERENCES "commission_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician_ledger" ADD CONSTRAINT "technician_ledger_job_cost_id_fkey" FOREIGN KEY ("job_cost_id") REFERENCES "job_costs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Raw SQL: constraints and indexes Prisma cannot express
-- ============================================================

-- 1. Rating range constraints
ALTER TABLE reviews
  ADD CONSTRAINT reviews_rating_check CHECK (rating BETWEEN 1 AND 5);

ALTER TABLE ai_feedback
  ADD CONSTRAINT ai_feedback_rating_check CHECK (rating BETWEEN 1 AND 5);

ALTER TABLE technician_profiles
  ADD CONSTRAINT technician_profiles_rating_check CHECK (rating >= 0 AND rating <= 5);

-- 2. One active assignment per request (partial unique index)
CREATE UNIQUE INDEX assignments_one_active_per_request
  ON assignments (request_id)
  WHERE status IN ('PENDING', 'ACCEPTED', 'IN_PROGRESS');

-- 3. External assignment consistency check
ALTER TABLE assignments
  ADD CONSTRAINT assignments_external_check CHECK (
    (is_external = false) OR
    (is_external = true AND external_name IS NOT NULL AND external_phone IS NOT NULL AND technician_profile_id IS NULL)
  );

-- 4. Job cost billing check
ALTER TABLE job_costs
  ADD CONSTRAINT job_costs_billing_source_check CHECK (
    (manual_labor_cost IS NOT NULL AND hours_worked IS NULL AND hourly_rate_used IS NULL) OR
    (manual_labor_cost IS NULL AND hours_worked IS NOT NULL AND hourly_rate_used IS NOT NULL)
  );

-- 5. Audit log immutability trigger
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- 6. HNSW vector similarity index (cosine distance, 1024 dims)
CREATE INDEX knowledge_chunks_embedding_hnsw
  ON knowledge_chunks
  USING hnsw (embedding vector_cosine_ops);
