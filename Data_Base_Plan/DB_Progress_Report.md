# Database Progress Report

Status as of 5 October 2026. This records what has been built and verified for the maintAIn database. The schema itself is described in [DB_Schema.md](DB_Schema.md); the implementation is `apps/backend/prisma/schema.prisma` and `apps/backend/prisma/migrations/`.

## 1. Summary

| Item | State |
| --- | --- |
| Database | PostgreSQL 16 with pgvector, running locally in Docker |
| Tables | 33 in 12 domains (34 including Prisma's `_prisma_migrations`) |
| ORM | Prisma 6.19, in `apps/backend` |
| Migrations | 1 (`20261005000000_init`, squashed from three), applied; `prisma migrate status` reports "Database schema is up to date" |
| Backend | NestJS scaffold builds and starts; global `PrismaModule` connects to the database |
| Verification | 40 database checks pass (section 7) |
| Source control | Committed as `28a15a2` and pushed to branch `system-design` |

## 2. Local environment

`docker-compose.yml` at the repository root runs three services:

| Service | Image | Purpose |
| --- | --- | --- |
| `postgres` | `pgvector/pgvector:pg16` | Main database with vector search |
| `redis` | `redis:7-alpine` | Queue backing store for the AI jobs, to be used later |
| `storage` | `rustfs/rustfs` | S3-compatible object storage for photos |

Notes:
- MinIO's official images are no longer published, so RustFS is a stand-in. The code should use the standard S3 API so the provider can be swapped (Cloudflare R2's free tier is the planned deployment target).
- Ollama is not in Docker; it runs on the host so it can use the GPU.
- The root `.env` holds only Postgres, Redis, and storage settings. `apps/backend/.env` holds `DATABASE_URL`, because Prisma does not read the root file. Both are gitignored. Ollama, JWT, and API port settings are intentionally not set yet.
- The pgvector extension is enabled by the first migration (`CREATE EXTENSION IF NOT EXISTS vector`), so a reset recreates it.

## 3. How the schema got to its current form

1. A first schema was built from the older 35-table design in the planning folder.
2. The product's own schema document replaced it. That document claimed 38 tables; counting its models gave 32. The 38 was a counting error: tables removed during redesign (`roles`, `staff_profiles`, `technician_availability`, `job_parts`, `service_prices`, `ai_messages`, `ai_tool_calls`) were never subtracted while new ones were added.
3. A review found blocking problems, and a corrected version (v2) fixed them: the team-member relation, the one-to-one case feedback link, assignment statuses and timestamps, billing for external technicians, and an availability flag for ranking.
4. The October decisions were then applied, adding `ai_tool_calls` and bringing the total to 33.

## 4. Tables by domain

| Domain | Tables |
| --- | --- |
| 1 Users and Auth | `users`, `user_roles`, `refresh_tokens` |
| 2 Customer Profiles | `customer_profiles` |
| 3 Technician Profiles | `technician_profiles`, `technician_tier_requests` |
| 4 Skills and Teams | `skills`, `teams`, `technician_skills`, `team_members` |
| 5 Equipment and Addresses | `equipment_types`, `addresses`, `equipment` |
| 6 Requests, Cases, and AI | `maintenance_requests`, `maintenance_cases`, `request_status_history`, `ai_conversations`, `ai_runs`, `ai_tool_calls` |
| 7 Assignments and Jobs | `assignments`, `job_reports`, `job_costs` |
| 8 Reviews and Feedback | `reviews`, `ai_feedback`, `case_feedback` |
| 9 Notifications | `notifications` |
| 10 Audit and Attachments | `audit_logs`, `attachments` |
| 11 Knowledge Base | `knowledge_sources`, `knowledge_documents`, `knowledge_chunks` |
| 12 Commission and Payouts | `commission_tiers`, `technician_ledger` |

## 5. Migrations

There is one migration, `20261005000000_init`. It was squashed from three that were built up during the day, and the merged file keeps their order in three labelled parts:

| Part | What it does |
| --- | --- |
| 1 Initial schema | Creates the pgvector extension, all tables from v2, and the raw SQL Prisma cannot express: rating range checks, one active assignment per request, the job cost billing check, the audit-log immutability trigger, and the HNSW vector index (1024 dimensions, cosine distance). |
| 2 External assignment check | Replaces the original check with a two-sided one: an internal assignment must have a technician profile and no external details, an external one must have a name and phone and no profile. |
| 3 Decisions | Renames enum types to snake_case and converts all timestamps to `timestamptz`. Adds foreign keys on every actor column, the `ai_tool_calls` table, `correlation_id` and `idempotency_key` on `ai_runs`, a `correlation_id` on `audit_logs`, new audit actions (`LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `AI_TOOL_CALL`), a nullable `contact_preference`, and three database rules (below). |

The squash was done before any teammate ran `migrate deploy`. It was verified by resetting the local database from the single file and re-running every check in section 7.

## 6. Database-level rules in force

| Rule | Mechanism |
| --- | --- |
| Review, AI feedback ratings are 1 to 5; technician rating is 0 to 5 | Check constraints |
| Only one active assignment (`PENDING`, `ACCEPTED`, `IN_PROGRESS`) per request | Partial unique index |
| Internal assignments need a technician profile and no external details; external ones need name and phone and no profile | Check constraint |
| A job cost uses either manual labor cost, or hours and an hourly rate, never both | Check constraint |
| Audit log rows can never be updated or deleted | Trigger |
| One commission charge per job | Partial unique index on `technician_ledger(job_cost_id)` |
| Every attachment has exactly one parent (request, job report, or conversation) | Check constraint |
| One in-flight AI run per idempotency key | Partial unique index on `ai_runs(idempotency_key)` |
| Who acted (`assigned_by`, `changed_by`, `verified_by`, `dispatcher_id`, `reviewed_by`, `recorded_by`, `cancelled_by`, payment actors, `created_by`) must be a real user | Foreign keys |
| One review per request, one AI rating per user per run | Unique constraints |
| Fast knowledge search | HNSW index on `knowledge_chunks.embedding` |

## 7. Verification

All run against the live local database inside a transaction that was rolled back; no test data remains.

- The build passes (`npm run build` in `apps/backend`) and the application starts and connects to the database.
- Every rule in section 6 was exercised with both an accepted case and a rejected case. Examples: an internal assignment without a technician, an external assignment without a phone, a second active assignment, a duplicate commission charge, an attachment with no parent or two parents, a duplicate in-flight AI run, review rating 6, and unknown actor IDs were all rejected; valid versions of each were accepted.
- Audit log update and delete are rejected, and the new `LOGIN` and `AI_TOOL_CALL` actions are accepted.
- Schema shape: no uppercase enum types, no timestamps without a time zone, HNSW index present, 33 application tables, and `ai_runs.correlation_id` is generated by the database.

## 8. Decisions that shape the data

- A customer's unpaid balance blocks normal and urgent requests; emergencies are accepted and flagged to the dispatcher.
- An assessed urgency of `HIGH` or `CRITICAL` escalates a request to emergency handling.
- Emergency requests create their case at submission.
- Payment is cash only. The technician uploads a photo of the paid invoice, and a dispatcher or manager confirms it. Commission is charged only at that confirmation.
- If a customer does not confirm an invoice, a dispatcher may confirm it on their behalf after 7 days.
- The manager approves technician applications and tier requests; the technician enters hours worked; an extra visit is billed as one hour at the rate used.
- Data policy: chats and images are kept 12 months after job completion and audit logs 3 years without personal content, customers can request deletion, and customer data is never used to train models. Verified-case text is de-identified before it is embedded.

## 9. Not done yet

- Application code: none of the business features exist yet (authentication, requests, assignments, payments, AI). The business rules above are therefore not yet enforced or tested in code.
- Seed data (roles, categories, skills, equipment types, commission tiers, demo users).
- Deletion and retention jobs, the de-identification pipeline, and the image-analysis evaluation set.
- Attachments have no malware-scan status (skipped for the MVP).
- The root npm workspace is declared but `npm install` has not been run at the root; until then `npx nest build` can pick up an old global CLI, so use `npm run build` inside `apps/backend`.

## 10. Reproducing this database

From the repository root, start the services with `docker compose up -d`. Then, from `apps/backend`, run `npx prisma migrate deploy` and `npx prisma generate`. `prisma migrate reset` drops all data and, when run by an AI assistant, needs explicit confirmation from the user.
