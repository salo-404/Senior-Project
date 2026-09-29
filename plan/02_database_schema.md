# Database Schema Plan

PostgreSQL is the single system of record. Prisma migrations define all schema changes. UUID primary keys, `created_at`, and `updated_at` are standard unless a record is immutable. Store lifecycle states as PostgreSQL/Prisma enums, not free text.

## Identity and Access

| Table | Important columns | Relationships |
| --- | --- | --- |
| `users` | `id`, `email`, `password_hash`, `is_active`, `last_login_at` | One-to-one optional profile per role; many roles |
| `roles` | `id`, `code` (`CUSTOMER`, `DISPATCHER`, `TECHNICIAN`, `MANAGER`) | Many users through `user_roles` |
| `user_roles` | `user_id`, `role_id` | Unique `(user_id, role_id)` |
| `customer_profiles` | `user_id`, `display_name`, `phone` | Owns addresses, equipment, requests |
| `customer_addresses` | `customer_id`, address fields, `is_default` | Used by cases/jobs |
| `technician_profiles` | `user_id`, `display_name`, `years_experience`, `hourly_rate`, `is_active` | Skills, availability, teams, assignments |
<!-- Updated: staff profiles -->
| `staff_profiles` | `user_id`, `display_name`, `phone` | Shared profile for dispatchers and managers; role distinction is owned by `user_roles`, with no separate dispatcher or manager profile table |
| `teams` | `id`, `name`, `is_active` | Many technicians through `technician_teams` |
| `technician_teams` | `technician_id`, `team_id` | Unique pair |
| `skills` | `id`, `code`, `name`, `service_scope` | Many technicians and equipment/case requirements |
| `technician_skills` | `technician_id`, `skill_id`, `proficiency_level` | Unique pair |
| `technician_availability` | `technician_id`, `starts_at`, `ends_at`, `status` | Drives eligibility/ranking |

## Core Maintenance Domain

| Table | Important columns | Relationships |
| --- | --- | --- |
| `equipment_types` | `id`, `category`, `name`, `is_active` | Referenced by equipment |
| `equipment` | `id`, `customer_id`, `equipment_type_id`, `brand`, `model`, `serial_number`, `location_note` | Optional link from request/case |
<!-- Updated: emergency request path -->
| `maintenance_requests` | `id`, `customer_profile_id`, `source` (`MANUAL`, `AI_ASSISTED`, `EMERGENCY_FORM`), `contact_preference VARCHAR` (`form` or `hotline`, emergency only), `status`, `priority`, raw report fields, `submitted_at` | One accepted request creates one case; emergency form requests require only description and location, bypass AI, and are immediately surfaced to dispatch |
| `maintenance_cases` | `id`, `request_id`, `customer_id`, `address_id`, `equipment_id`, `category`, `urgency`, `safety_flags`, `status`, `summary`, `created_at` | Central operational record |
| `case_status_history` | `case_id`, `from_status`, `to_status`, `actor_user_id`, `reason`, `created_at` | Append-only history |
| `attachments` | `id`, `owner_user_id`, `request_id`, `case_id`, `object_key`, `media_type`, `size_bytes`, `scan_status` | Metadata only; object lives in storage |
| `assignments` | `id`, `case_id`, `technician_profile_id`, `assigned_by_user_id`, `status`, `rank_snapshot`, `assigned_at` | Preserve recommendation/rationale snapshot |
<!-- Updated: technician case feedback -->
| `job_reports` | `id`, `assignment_id`, `technician_id`, `finding`, `work_performed`, `verified_outcome`, `completion_evidence`, `ai_analysis_was_helpful`, `completed_at` | One authoritative completion report per completed assignment; the technician records their own AI-helpfulness perspective |
| `reviews` | `id`, `case_id`, `customer_id`, `rating`, `comment`, `submitted_at` | One review per eligible case/customer |
| `notifications` | `id`, `user_id`, `type`, `payload`, `is_read`, `read_at` | Created by domain events |
| `audit_logs` | `id`, `user_id`, `action`, `entity_type`, `entity_id`, `before_json`, `after_json`, `request_id`, `created_at` | Append-only critical-action trail |

<!-- Updated: technician case feedback -->
Optional tables remain out of the first migration unless a concrete workflow needs them: `maintenance_symptoms`, `maintenance_causes`, `case_evidence`, `job_parts`, `service_prices`, `job_costs`, and `technician_case_feedback`. When activated, `technician_case_feedback` is completed by the dispatcher after reviewing a completed job report; it records whether the AI prediction was accurate and whether the verified outcome is approved for RAG knowledge promotion.

## AI and Knowledge Domain

| Table | Important columns | Relationships |
| --- | --- | --- |
| `ai_conversations` | `id`, `owner_user_id`, `role_context`, `case_id`, `status` | Contains messages and runs; technician conversations must link to a permitted case |
| `ai_messages` | `id`, `conversation_id`, `sender_type`, `content`, `attachment_ids`, `created_at` | Preserve displayed conversation history |
| `ai_runs` | `id`, `conversation_id`, `job_type`, `status`, `contract_version`, `input_hash`, `result_json`, `failure_code`, `started_at`, `finished_at` | Queue/run lifecycle and idempotency anchor |
| `ai_tool_calls` | `id`, `ai_run_id`, `tool_name`, `requested_by_role`, `input_json`, `result_summary`, `status` | Audit each controlled tool request |
| `ai_feedback` | `id`, `ai_run_id`, `actor_user_id`, `rating`, `correction`, `created_at` | Human feedback, never trusted knowledge by itself |
| `knowledge_sources` | `id`, `source_type`, `title`, `provenance`, `status`, `approved_by_user_id` | Parent of documents |
| `knowledge_documents` | `id`, `source_id`, `object_key`, `checksum`, `extracted_text_version`, `status` | Source document or approved case representation |
| `knowledge_chunks` | `id`, `document_id`, `content`, `chunk_index`, `embedding`, `metadata_json`, `is_active` | Queryable RAG chunks |

## Critical Relationships and Constraints

- `maintenance_requests` has at most one `maintenance_cases` row. A customer-approved AI draft becomes a request before it becomes a case.
- Only the currently active assignment can move a case from `ASSIGNED` to `IN_PROGRESS` or `COMPLETED`.
- `case_status_history` is written in the same transaction as a case status change.
- `job_reports.verified_outcome` is immutable after completion except through an audited correction workflow.
- `reviews` has unique `(case_id, customer_id)`.
- Every stored attachment has one owning user and one permitted domain parent. Do not rely on object names as authorization.
- `ai_runs` needs an idempotency key such as `(job_type, input_hash, active status)` to avoid duplicate worker effects.

## pgvector Note

Enable the PostgreSQL `vector` extension in a Prisma migration. Store one embedding vector per `knowledge_chunks` row using the dimension required by the selected local embedding model. Add an approximate-nearest-neighbor vector index only after that model and dimension are fixed. Keep metadata columns for source ID, category, equipment type, safety level, and approval status so retrieval can filter before similarity ranking.

## Required Indexes

<!-- Updated: database indexes -->

| Table | Index | Purpose |
| --- | --- | --- |
| `maintenance_requests` | `customer_profile_id`, `status`, `priority` | Customer history and dispatcher queue filtering |
| `assignments` | `technician_profile_id`, `status` | Technician workload and active-assignment lookups |
| `ai_messages` | `conversation_id` | Ordered conversation retrieval |
| `audit_logs` | `user_id`; composite `(entity_type, entity_id)` | Actor and entity audit trails |
| `notifications` | composite `(user_id, is_read)` | Unread notification polling |
| `knowledge_chunks` | `embedding` using pgvector `ivfflat` cosine index | Filtered similarity retrieval after the embedding dimension is fixed |

## Schema Risks

- Confirm the embedding model before generating the vector column dimension; changing it later requires re-embedding all chunks.
- `rank_snapshot` must capture input factors and weights at assignment time, not merely the winning technician ID, to make recommendations auditable.
- Define retention and deletion rules for images, chat records, and audit logs before production data is collected.
