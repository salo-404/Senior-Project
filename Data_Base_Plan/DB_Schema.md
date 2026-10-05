# maintAIn Database Schema (v2)

Describes the schema implemented in `apps/backend/prisma/schema.prisma` and the `init` migration. If this file and `schema.prisma` ever disagree, fix whichever is wrong in the same change.

## 1. Overview

| Item | Value |
| --- | --- |
| Tables | 33 (34 including Prisma's `_prisma_migrations`) |
| Domains | 12 |
| Database | PostgreSQL 16, image `pgvector/pgvector:pg16` |
| ORM | Prisma 6, in `apps/backend` only |
| Vector | pgvector, `vector(1024)` (BGE-M3 via Ollama) |
| IDs | UUID v4 everywhere |
| Timestamps | `timestamptz` (UTC) |
| Money | `Decimal(10,2)` |
| Ratings | `Decimal(3,2)` |
| Maintenance categories | `HVAC`, `HOME_APPLIANCES` |

The 38 in earlier drafts was a counting error: tables dropped during redesign were never subtracted. The 33rd table, `ai_tool_calls`, was added after the schema review.

## 2. Global rules

- Table and column names are `snake_case`; tables are plural. Prisma models are PascalCase with `@@map`.
- Fixed-value columns are enums. Enum types are snake_case in the database (for example `request_status`); the names below are the Prisma names.
- Actor columns (`assigned_by`, `changed_by`, `verified_by`, `dispatcher_id`, `reviewed_by`, `recorded_by`, `cancelled_by`, `created_by`, `confirmed_on_behalf_by`, `invoice_submitted_by`, `payment_confirmed_by`) are foreign keys to `users`; `proposed_tier_id` and `final_tier_id` are foreign keys to `commission_tiers`.
- Users, knowledge sources, and reviews are deactivated or hidden (`is_active`, `is_visible`), not deleted. `audit_logs` rows are immutable (database trigger).
- `knowledge_chunks.embedding` is read and written only through `$queryRaw` / `$executeRaw`.
- Only Prisma migrates the schema. The Python AI worker has no database credentials: NestJS serves knowledge retrieval and stores the chunks the worker produces. The LLM never touches the database, never generates SQL, and cannot change status, approve, assign, calculate costs or rankings, or add knowledge.

## 3. Enums

| Enum | Values |
| --- | --- |
| `Role` | `CUSTOMER`, `DISPATCHER`, `TECHNICIAN`, `MANAGER` |
| `MaintenanceCategory` | `HVAC`, `HOME_APPLIANCES` |
| `RequestPriority` | `NORMAL`, `URGENT`, `EMERGENCY` |
| `RequestStatus` | `NEW`, `UNDER_REVIEW`, `APPROVED`, `ASSIGNED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `REQUIRES_FOLLOW_UP`, `REJECTED` |
| `AiAnalysisStatus` | `PENDING`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `SKIPPED` |
| `AssignmentStatus` | `PENDING`, `ACCEPTED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `REJECTED` |
| `ProfileStatus` | `PENDING_REVIEW`, `APPROVED`, `REJECTED` |
| `TierRequestType` | `INITIAL_APPLICATION`, `TIER_UPDATE` |
| `TierRequestStatus` | `PENDING`, `APPROVED`, `REJECTED` |
| `TierDecisionOutcome` | `TIER_CHANGED`, `SKILLS_NOTED_ONLY`, `NO_CHANGE` |
| `CommissionTierName` | `BRONZE`, `SILVER`, `GOLD` |
| `LedgerEntryType` | `COMMISSION_CHARGE`, `PAYMENT_RECEIVED`, `ADJUSTMENT` |
| `InvoiceStatus` | `PENDING_CONFIRMATION`, `CONFIRMED`, `DISPUTED` |
| `PaymentStatus` | `PENDING`, `INVOICE_SUBMITTED`, `CONFIRMED`, `DISPUTED` |
| `PaymentMethod` | `CASH`, `TRANSFER`, `OTHER` |
| `AttachmentPurpose` | `CUSTOMER_PHOTO`, `TECHNICIAN_PHOTO`, `INVOICE_PHOTO` |
| `KnowledgeSourceType` | `MANUAL`, `CASE_REPORT`, `GUIDELINE` |
| `ProcessingStatus` | `PENDING`, `PROCESSED`, `FAILED` |
| `AiAgentType` | `MAINTENANCE_INTELLIGENCE`, `OPERATIONS_INTELLIGENCE`, `ORCHESTRATOR` |
| `CaseSource` | `AI`, `MANUAL` |
| `ContactPreference` | `FORM`, `HOTLINE` |
| `UrgencyLevel` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `RateType` | `NORMAL`, `EMERGENCY` |
| `AiRunStatus` | `PENDING`, `IN_PROGRESS`, `COMPLETED`, `FAILED` |
| `NotificationType` | `REQUEST_SUBMITTED`, `REQUEST_STATUS_CHANGED`, `ASSIGNMENT_CREATED`, `ASSIGNMENT_ACCEPTED`, `JOB_STARTED`, `JOB_COMPLETED`, `INVOICE_SUBMITTED`, `PAYMENT_CONFIRMED`, `PAYMENT_DISPUTED`, `SAFETY_ESCALATED`, `COMMISSION_CHARGED`, `TIER_CHANGED`, `SYSTEM` |
| `ToolCallStatus` | `SUCCESS`, `FAILED`, `UNAUTHORIZED` |
| `NotificationPriority` | `NORMAL`, `HIGH`, `URGENT` |
| `AuditAction` | `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `USER_CREATED`, `USER_UPDATED`, `USER_DEACTIVATED`, `PASSWORD_CHANGED`, `REQUEST_CREATED`, `REQUEST_STATUS_CHANGED`, `REQUEST_CANCELLED`, `CASE_VERIFIED`, `CASE_CREATED_MANUAL`, `ASSIGNMENT_CREATED`, `ASSIGNMENT_ACCEPTED`, `ASSIGNMENT_STARTED`, `ASSIGNMENT_REJECTED`, `ASSIGNMENT_CANCELLED`, `JOB_REPORT_SUBMITTED`, `INVOICE_CONFIRMED_BY_CUSTOMER`, `INVOICE_DISPUTED`, `INVOICE_CONFIRMED_ON_BEHALF`, `INVOICE_PHOTO_SUBMITTED`, `PAYMENT_CONFIRMED`, `PAYMENT_DISPUTED`, `TECHNICIAN_APPROVED`, `TECHNICIAN_REJECTED`, `TIER_CHANGED`, `COMMISSION_CHARGED`, `COMMISSION_PAYMENT_RECORDED`, `KNOWLEDGE_PROMOTED`, `AI_TOOL_CALL`, `SAFETY_ESCALATED`, `EMERGENCY_DOWNGRADED` |

## 4. Tables

Unless a column is marked optional (`?`), it is `NOT NULL`. Every table has `created_at`; tables that change also have `updated_at`.

### Domain 1: Users and Auth

- **`users`**: `email` (unique), `phone?` (unique), `password_hash`, `first_name`, `last_name`, `is_active` (default true). Dispatchers and managers have no profile table.
- **`user_roles`**: `(user_id, role)` composite key; a user may hold several roles.
- **`refresh_tokens`**: `user_id`, `token_hash` (unique), `expires_at`, `is_revoked` (default false). Index on `user_id`.

### Domain 2: Customer Profiles

- **`customer_profiles`**: `user_id` (unique), `has_unpaid_balance` (default false), `unpaid_amount` (default 0).

### Domain 3: Technician Profiles

- **`technician_profiles`**: `user_id` (unique), `bio?`, `years_of_experience`, `rating` (0-5), `total_reviews`, `profile_status` (default `PENDING_REVIEW`), `current_tier_id?` (-> `commission_tiers`), `outstanding_balance`, `is_payment_blocked`, `is_available` (default true), `normal_rate`, `emergency_rate`.
- **`technician_tier_requests`**: `technician_profile_id`, `request_type`, `proposed_tier_id?`, `supporting_notes?`, `status`, `decision_outcome?`, `final_tier_id?`, `reviewed_by?`, `review_notes?`.

### Domain 4: Skills and Teams

- **`skills`**: `name` (unique), `category`, `description?`.
- **`teams`**: `name`, `category`, `description?`.
- **`technician_skills`**: composite key `(technician_profile_id, skill_id)`, `proficiency_level` (int, default 1).
- **`team_members`**: composite key `(team_id, user_id)`, `role_in_team?`, `joined_at`. `user_id` references `technician_profiles.user_id`.

### Domain 5: Equipment and Addresses

- **`equipment_types`**: `name`, `category`, `description?`. Examples: Split AC, Central AC, Ventilation Unit (`HVAC`); Refrigerator, Washing Machine, Dishwasher (`HOME_APPLIANCES`).
- **`addresses`**: `user_id`, `label?`, `street`, `city`, `district?`, `floor?`, `building?`, `notes?`, `is_default`.
- **`equipment`**: `user_id`, `equipment_type_id`, `address_id?`, `name`, `brand?`, `model?`, `serial_number?`, `installation_date?`, `notes?`. Brand and model feed RAG retrieval.

### Domain 6: Requests and Cases

- **`maintenance_requests`**: `customer_id`, `equipment_id`, `address_id`, `title`, `description?`, `priority` (default `NORMAL`), `status` (default `NEW`), `ai_analysis_status` (default `PENDING`), `problem_type?`, `intake_answers?` (JSON), `is_safety_escalated`, `escalated_at?`, `escalation_reason?`, `rejection_reason?`, `cancellation_reason?`, `cancelled_by?`, `contact_preference?` (set only for emergencies). Indexes: customer, status, priority, ai_analysis_status.
- **`maintenance_cases`**: `request_id` (unique), `source`, `summary?`, `urgency_level?`, `safety_flags?`, `symptoms?`, `follow_up_questions?`, `possible_causes?` (all JSON), `verified_by?`, `verified_at?`.
- **`request_status_history`**: `request_id`, `from_status?`, `to_status`, `changed_by`, `reason?`. Written in the same transaction as every status change. Index on `request_id`.
- **`ai_conversations`**: `request_id?` (set when a draft is submitted), `user_id`, `role`, `messages` (JSON). Index on `user_id`.
- **`ai_runs`**: `conversation_id?`, `request_id?`, `agent_type`, `model_name?`, `prompt_tokens?`, `completion_tokens?`, `latency_ms?`, `status` (default `PENDING`), `error_message?`, `correlation_id` (database-generated UUID), `idempotency_key?`. A partial unique index allows one `PENDING` or `IN_PROGRESS` run per idempotency key.
- **`ai_tool_calls`**: `ai_run_id`, `tool_name`, `input` (JSON), `output?` (JSON), `status` (`SUCCESS`, `FAILED`, `UNAUTHORIZED`), `duration_ms?`. One row per controlled tool request, including unauthorized attempts. Index on `ai_run_id`.

Rules: a request is the raw submission and a case is the structured record; a request has at most one case. Manual requests use `ai_analysis_status = SKIPPED`; AI-assisted requests move through `PENDING`, `IN_PROGRESS`, then `COMPLETED` or `FAILED`; failed AI work leaves the raw request available to dispatch. Emergency requests set `priority = EMERGENCY`, `is_safety_escalated = true`, `escalated_at`, `escalation_reason`, and `ai_analysis_status = SKIPPED`, and create their `maintenance_cases` row at submission. A request whose assessed urgency (`urgency_level`) is `HIGH` or `CRITICAL` is escalated to emergency handling by the backend; the AI may only flag it, and `EMERGENCY_DOWNGRADED` records a reversal. The hotline option creates nothing. AI cannot change status.

#### Allowed status transitions

| From | To | Actor |
| --- | --- | --- |
| None | `NEW` | Customer submits |
| `NEW` | `UNDER_REVIEW` | Dispatcher opens it |
| `UNDER_REVIEW` | `REQUIRES_FOLLOW_UP` | Dispatcher needs information |
| `REQUIRES_FOLLOW_UP` | `UNDER_REVIEW` | Customer answers |
| `UNDER_REVIEW` | `APPROVED` | Dispatcher |
| `UNDER_REVIEW` | `REJECTED` | Dispatcher, with `rejection_reason` |
| `APPROVED` | `ASSIGNED` | Dispatcher assigns |
| `ASSIGNED` | `APPROVED` | Technician rejects the assignment |
| `ASSIGNED` | `IN_PROGRESS` | Technician starts (after accepting) |
| `IN_PROGRESS` | `COMPLETED` | Technician submits the job report |
| `NEW`, `UNDER_REVIEW`, `REQUIRES_FOLLOW_UP`, `APPROVED`, or `ASSIGNED` | `CANCELLED` | Customer, with reason |

`COMPLETED`, `CANCELLED`, and `REJECTED` are terminal. Customers cannot cancel `IN_PROGRESS` work. Cancelling an `ASSIGNED` request also sets its active assignment to `CANCELLED`.

### Domain 7: Assignments and Jobs

- **`assignments`**: `request_id`, `technician_profile_id?`, `is_external`, `external_name?`, `external_phone?`, `assigned_by`, `status` (default `PENDING`), `rejection_reason?`, `delay_reason?`, `scheduled_at?`, `accepted_at?`, `started_at?`, `expected_return_at?`, `visit_count` (default 1), `ranking_snapshot?` (JSON). Indexes: request, technician, status.
- **`job_reports`**: `assignment_id` (unique), `diagnosis?`, `work_done?`, `parts_used?` (JSON list of name, quantity, unit cost), `ai_analysis_was_helpful?`, `notes?`, `submitted_at?`.
- **`job_costs`**: `assignment_id` (unique), `hours_worked?`, `hourly_rate_used?`, `rate_type?`, `extra_visits`, `manual_labor_cost?`, `parts_cost`, `labor_cost`, `total_cost`, `invoice_status`, `customer_confirmed_at?`, `confirmed_on_behalf_by?`, `dispute_reason?`, `payment_status`, `payment_method` (default `CASH`), `invoice_submitted_at?`, `invoice_submitted_by?`, `payment_confirmed_by?`, `payment_confirmed_at?`.

Assignment rules: only dispatchers create assignments; AI recommends nothing it computes itself. Normal jobs use registered technicians; an external technician is allowed only for emergencies when no internal technician is available, has no profile or login, and the assignment is for tracking. When `is_external = true`, `external_name` and `external_phone` are required and `technician_profile_id` is null. Only one assignment per request may be `PENDING`, `ACCEPTED`, or `IN_PROGRESS`. A technician rejection marks the assignment `REJECTED` and returns the request to `APPROVED`. External jobs get no review, commission, or ledger entry, and the dispatcher fills the job report from a phone call.

Cost rules (backend-owned): internal jobs use `labor_cost = hours_worked x hourly_rate_used` plus `extra_visits x hourly_rate_used`, where the rate is `emergency_rate` for emergency requests and `normal_rate` otherwise, recorded with `rate_type`. External jobs set `manual_labor_cost` and leave hours and rate empty. `parts_cost` is the sum of quantity times unit cost in `parts_used`. `total_cost = labor_cost + parts_cost`. There is no base price.

### Domain 8: Reviews and Feedback

- **`reviews`**: `request_id` (unique), `technician_profile_id`, `customer_id`, `rating` (1-5), `comment?`, `is_visible` (default true). Index on technician.
- **`ai_feedback`**: `ai_run_id`, `user_id`, `rating` (1-5), `comment?`; unique `(ai_run_id, user_id)`.
- **`case_feedback`**: `case_id` (unique), `dispatcher_id`, `is_accurate`, `notes?`, `approved_for_knowledge` (default false).

Rules: one review per completed request, only by its customer, never for external jobs. A manager can hide but not delete a review; the technician's `rating` is recalculated from visible reviews. `case_feedback` is the only knowledge-promotion gate; the technician is found through case, request, assignment.

#### Feedback sources

| Location | Actor | Meaning |
| --- | --- | --- |
| `ai_feedback` | Any user | Whether an AI chat response was helpful |
| `job_reports.ai_analysis_was_helpful` | Technician | Whether AI preparation helped on site |
| `case_feedback` | Dispatcher | Whether the AI cause matched the actual cause; the knowledge-promotion gate |

### Domain 9: Notifications

- **`notifications`**: `user_id`, `notification_type`, `priority` (default `NORMAL`), `title`, `body`, `data?` (JSON), `request_id?`, `is_read`, `read_at?`. Index `(user_id, is_read)`.

Emergency requests notify all dispatchers (`SAFETY_ESCALATED`, `URGENT`), and include the customer's unpaid balance when there is one. Notifications are never deleted. MVP delivery polls every 30 seconds.

### Domain 10: Audit and Attachments

- **`audit_logs`**: `user_id?`, `action`, `entity_type`, `entity_id` (text), `old_value?`, `new_value?`, `ip_address?`, `correlation_id?` (ties a record to a request or AI run). Indexes: `(entity_type, entity_id)`, `user_id`, `created_at`. Append-only; `user_id` is null for system actions.
- **`attachments`**: `user_id`, `request_id?`, `job_report_id?`, `conversation_id?`, `purpose`, `file_url`, `file_type`, `file_size`. Indexes: request, job report. `file_url` is a non-guessable object-storage key; images sent in AI chat belong to the conversation until the request exists. Invoice photos are rows with `purpose = INVOICE_PHOTO` and a `job_report_id`. A database check requires exactly one of `request_id`, `job_report_id`, or `conversation_id`; a chat image moves to the request when the request is submitted.

### Domain 11: Knowledge Base

- **`knowledge_sources`**: `title`, `source_type`, `category`, `file_url?`, `is_active` (default true), `created_by`.
- **`knowledge_documents`**: `source_id`, `source_job_report_id?`, `content`, `processing_status` (default `PENDING`), `total_chunks?`, `verified_by?`.
- **`knowledge_chunks`**: `document_id`, `content`, `embedding vector(1024)`, `chunk_index`, `metadata?` (JSON: category, equipment type, brand, used to filter before similarity ranking).

Knowledge promotion: technician submits the job report, the dispatcher completes `case_feedback` with `approved_for_knowledge = true`, the backend creates a `CASE_REPORT` document, the worker chunks and embeds it, NestJS stores the chunks, and an audit record with `KNOWLEDGE_PROMOTED` is written. AI never adds knowledge directly. Trust order: verified case report, manual, guideline.

### Domain 12: Commission and Payouts

- **`commission_tiers`**: `name` (unique), `commission_rate` (e.g. 0.10), `min_rating?`, `min_experience_years?`, `min_completed_jobs?`.
- **`technician_ledger`**: `technician_profile_id`, `entry_type`, `amount`, `balance_after`, `job_cost_id?`, `tier_id_at_charge?`, `rate_applied?`, `recorded_by?`, `payment_note?`.

Commission applies to registered technicians only, on `labor_cost` (parts excluded), and is charged only when payment is confirmed: not on job completion and not on invoice confirmation. A partial unique index allows one `COMMISSION_CHARGE` per `job_cost_id`. A manager records payments received.

## 5. Payment flow

```text
Technician completes the job -> backend creates job_costs (invoice PENDING_CONFIRMATION, payment PENDING)
Customer reviews the invoice -> confirms (or, after 7 days without a response, a dispatcher confirms on their behalf, audited) -> invoice CONFIRMED
Customer pays cash to the technician (outside the app)
Technician photographs the paid invoice and uploads it -> attachment INVOICE_PHOTO, payment INVOICE_SUBMITTED
Dispatcher or manager reviews the photo
  match    -> payment CONFIRMED, payment_confirmed_by/at set, PAYMENT_CONFIRMED audit, commission charged
  mismatch -> payment DISPUTED, PAYMENT_DISPUTED audit, flagged on the manager dashboard
```

Rules: cash only, no gateway; the photo is required before `CONFIRMED`; only a dispatcher or manager confirms or disputes; `DISPUTED` blocks the customer like `PENDING`. `customer_profiles.has_unpaid_balance` is recomputed from all of the customer's jobs: true when any job has `invoice_status = CONFIRMED` and `payment_status != CONFIRMED`. While true, the customer cannot submit a normal or urgent request. An emergency request is still accepted, and the dispatcher is shown the unpaid balance as a flag.

## 6. Ranking reference

NestJS computes it; AI never does. Store the result in `assignments.ranking_snapshot`.

| Factor | Normal | Emergency | Source |
| --- | ---: | ---: | --- |
| Skill | 30% | 30% | `technician_skills` proficiency, category match |
| Availability | 30% | 40% | `is_available` and active assignments |
| Experience | 15% | 15% | `technician_profiles.years_of_experience` |
| Feedback | 15% | 10% | `technician_profiles.rating` |
| Rate | 10% | 5% | `normal_rate` or `emergency_rate` by request priority; lower is better |

Rate score: `1 - (rate - min) / (max - min)` across candidates; `1.0` for all when `max = min`. A technician with an `ACCEPTED` or `IN_PROGRESS` assignment scores 0 on availability. Distance is not part of the MVP; GPS, a map view, and route optimization are future work.

## 7. Raw SQL in the `init` migration

1. `CREATE EXTENSION IF NOT EXISTS vector` (first statement).
2. `reviews.rating` and `ai_feedback.rating` between 1 and 5; `technician_profiles.rating` between 0 and 5.
3. Partial unique index `assignments_one_active_per_request` on `request_id` where status is `PENDING`, `ACCEPTED`, or `IN_PROGRESS`.
4. `assignments_external_check`: an external row needs a name, a phone, and no technician profile.
5. `job_costs_billing_source_check`: either `manual_labor_cost` with no hours or rate, or hours and rate with no manual cost.
6. Immutability trigger `audit_logs_immutable` rejecting every update or delete.
7. HNSW index `knowledge_chunks_embedding_hnsw` with `vector_cosine_ops`.
8. Decisions (part of the single `20261005000000_init` migration): `assignments_external_check` made two-sided; partial unique index `technician_ledger_one_commission_per_job`; check `attachments_one_parent_check`; partial unique index `ai_runs_one_inflight_per_key`; enum types renamed to snake_case; timestamps converted to `timestamptz`; foreign keys added to the actor columns.

## 8. Manager financial summary

Simple aggregation over `job_costs`, no reporting table: confirmed revenue by period (`payment_status = CONFIRMED`, by `payment_confirmed_at`); revenue by equipment category (join assignments, requests, equipment, equipment types); counts and totals of `PENDING`, `INVOICE_SUBMITTED`, and `DISPUTED` payments.

## 9. Domain summary

| Domain | Tables |
| --- | ---: |
| 1 Users and Auth | 3 |
| 2 Customer Profiles | 1 |
| 3 Technician Profiles | 2 |
| 4 Skills and Teams | 4 |
| 5 Equipment and Addresses | 3 |
| 6 Requests and Cases | 6 |
| 7 Assignments and Jobs | 3 |
| 8 Reviews and Feedback | 3 |
| 9 Notifications | 1 |
| 10 Audit and Attachments | 2 |
| 11 Knowledge Base | 3 |
| 12 Commission and Payouts | 2 |
| Total | 33 |

## 10. Remaining open items

- The tier-request reviewer is the manager and the technician enters hours worked, as decided; neither is enforced by the schema.
- Attachments have no scan status (decided: skip for the MVP).
- Retention periods and deletion on request (see `plan/07_security_plan.md`) are decided but not yet implemented.
- Image-analysis acceptance criteria and the de-identification pipeline for verified-case text are decided but not yet built.
- Qwen runs locally through Ollama with the online Qwen API as the fallback model; the exact model names are set in configuration.
