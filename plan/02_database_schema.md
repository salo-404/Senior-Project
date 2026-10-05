# Database Schema Plan

The schema is defined by `apps/backend/prisma/schema.prisma` (Prisma 6, PostgreSQL 16 with pgvector) and described in full in [Data_Base_Plan/DB_Schema.md](../Data_Base_Plan/DB_Schema.md): **33 tables in 12 domains**. This file summarizes the decisions the rest of the plan depends on. If it disagrees with `DB_Schema.md`, that file wins.

## Standards

- UUID v4 primary keys. Timestamps are `timestamptz` (UTC). Enum types are snake_case in the database. Money is `Decimal(10,2)`; ratings are `Decimal(3,2)`.
- Roles are a `Role` enum on `user_roles`; there is no `roles` table. Dispatchers and managers have no profile table: names and phone live on `users`.
- Fixed-value columns are enums, not free text. Only Prisma creates migrations; checks and indexes Prisma cannot express go in the raw SQL block of the `init` migration (see `DB_Schema.md`).
- User IDs that record who acted (`assigned_by`, `changed_by`, `verified_by`, `dispatcher_id`, `reviewed_by`, `recorded_by`, the payment actors, `cancelled_by`, `created_by`) are foreign keys to `users`.

## Domains

| Domain | Tables |
| --- | --- |
| 1 Users and Auth | `users`, `user_roles`, `refresh_tokens` |
| 2 Customer Profiles | `customer_profiles` |
| 3 Technician Profiles | `technician_profiles`, `technician_tier_requests` |
| 4 Skills and Teams | `skills`, `teams`, `technician_skills`, `team_members` |
| 5 Equipment and Addresses | `equipment_types`, `addresses`, `equipment` |
| 6 Requests and Cases | `maintenance_requests`, `maintenance_cases`, `request_status_history`, `ai_conversations`, `ai_runs`, `ai_tool_calls` |
| 7 Assignments and Jobs | `assignments`, `job_reports`, `job_costs` |
| 8 Reviews and Feedback | `reviews`, `ai_feedback`, `case_feedback` |
| 9 Notifications | `notifications` |
| 10 Audit and Attachments | `audit_logs`, `attachments` |
| 11 Knowledge Base | `knowledge_sources`, `knowledge_documents`, `knowledge_chunks` |
| 12 Commission and Payouts | `commission_tiers`, `technician_ledger` |

## Decisions that shape other plans

- **Request and case:** a request (`maintenance_requests`) carries the lifecycle status and its history; a case (`maintenance_cases`) is the structured record, with `source` of `AI` or `MANUAL`. One request has at most one case.
- **Lifecycle:** `NEW`, `UNDER_REVIEW`, `REQUIRES_FOLLOW_UP`, `APPROVED`, `ASSIGNED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `REJECTED`. Every change writes `request_status_history`.
- **Vocabulary:** `request_priority` (`NORMAL`, `URGENT`, `EMERGENCY`) is customer-chosen. The case's `urgency_level` is `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`; an assessed `HIGH` or `CRITICAL` escalates the request to emergency handling.
- **Assignments:** statuses `PENDING`, `ACCEPTED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `REJECTED`, with `scheduled_at`, `accepted_at`, `started_at`. Only one assignment per request may be `PENDING`, `ACCEPTED`, or `IN_PROGRESS`. External technicians are `is_external` rows with a name and phone and no profile.
- **Ranking:** `assignments.ranking_snapshot` stores the ranked list at assignment time. Technician `normal_rate` and `emergency_rate` feed the rate factor; `is_available` plus active assignments feed availability.
- **Money:** `job_costs` stores hours, the rate used and its `rate_type`, parts, labor, total, invoice status, and payment status. Hours and rate are null and `manual_labor_cost` is set for external technicians. There is no base price or service price table.
- **Payment:** cash only, with an invoice photo stored in `attachments` (`INVOICE_PHOTO`). `customer_profiles.has_unpaid_balance` blocks normal and urgent requests; emergencies pass with a dispatcher flag.
- **Commission:** `commission_tiers`, `technician_ledger`, and technician `outstanding_balance` and `is_payment_blocked` apply only to registered technicians.
- **Feedback:** the dispatcher's `case_feedback.approved_for_knowledge` is the only knowledge-promotion gate.
- **AI storage:** conversations keep messages as JSON; `ai_runs` stores run metrics, a correlation ID, and an idempotency key; `ai_tool_calls` records every controlled tool request.
- **Vectors:** `knowledge_chunks.embedding` is `vector(1024)` (BGE-M3) with an HNSW cosine index, queried through `$queryRaw`. Chunk `metadata` JSON carries category, equipment type, and brand for filtering.
- **Worker access:** the Python worker has no database credentials; NestJS serves retrieval and stores ingested chunks.

## Schema risks

- `has_unpaid_balance` is a single flag and must be recomputed across all of a customer's unpaid jobs, not toggled.
- Retention, deletion on request, and the verified-case de-identification pipeline are decided (see `plan/07_security_plan.md`) but not yet implemented.
