# NestJS Module Plan

## Build Order at a Glance

`01 auth/identity/audit -> 02 files/equipment/cases -> 03 dispatch/notifications -> 04 jobs/billing/reviews -> 05 ai-gateway -> 06 knowledge -> 07 analytics`

Modules 1 and 2 are self-contained, testable milestones. They establish a working manual platform before any queue, model, or RAG work begins. Table names below refer to the 33-table schema in `Data_Base_Plan/DB_Schema.md`.

## 1. Auth, Identity, and Audit (first self-contained milestone)

**Purpose:** authenticate users, enforce four roles, manage profiles, and record critical actions.

**Entities:** `users`, `user_roles`, `refresh_tokens`, `customer_profiles`, `technician_profiles`, `audit_logs`. Roles are an enum; dispatchers and managers have no profile table.

| Endpoint | Role | Purpose |
| --- | --- | --- |
| `POST /auth/login` | Public | Issue JWT access token and a refresh token (stored hashed in `refresh_tokens`) |
| `POST /auth/refresh` | Authenticated | Rotate the refresh token |
| `POST /auth/logout` | Authenticated | Mark the refresh token `is_revoked` |
| `GET /me` | Authenticated | Return identity, roles, and own profile |
| `PATCH /me/profile` | Authenticated | Update own profile fields |
| `GET /users/:id` | Dispatcher, Manager | Read permitted user/profile summary |
| `GET /audit-logs` | Manager | Read filtered audit records |

**Dependencies:** none for login/RBAC; audit is a shared dependency for later critical mutations.

**Testable outcome:** seed one account per role; verify login, token rejection after revoke, role guard behavior, self-only profile updates, and audited profile changes.

## 2. Files, Equipment, and Cases (second self-contained milestone)

**Purpose:** deliver the manual customer-to-dispatcher case workflow with no AI, queue, or technician assignment required.

The MVP supports HVAC/Air Conditioning and home appliances (fridges, washing machines, and dishwashers) in indoor spaces: homes, offices, universities, and schools. Plumbing, electrical, and generators remain future directions outside MVP scope.

**Entities:** `addresses`, `equipment_types`, `equipment`, `maintenance_requests`, `maintenance_cases`, `request_status_history`, `attachments`. Lifecycle status lives on `maintenance_requests`; "case" in the API is the request plus its case record.

| Endpoint | Role | Purpose |
| --- | --- | --- |
| `POST /files/uploads` | Customer, Technician | Begin authorized attachment upload and create metadata |
| `GET /files/:id` | Owner, authorized dispatcher/technician/manager | Resolve authorized access to an attachment |
| `POST /addresses`, `GET /addresses` | Customer | Manage own addresses (one default) |
| `POST /equipment` | Customer | Register owned equipment |
| `GET /equipment` | Customer | List own equipment |
| `POST /requests` | Customer | Submit a manual maintenance request (blocked for normal and urgent requests while `has_unpaid_balance`) |
| `POST /requests/emergency` | Customer | Submit the simplified EMERGENCY form using registered equipment, default/changeable address, short description, contact preference, and optional photo; bypass AI and notify dispatch immediately; never blocked by `has_unpaid_balance`, which is shown to the dispatcher as a flag |
| `GET /cases` | Customer, Dispatcher, Manager | List cases within role scope |
| `GET /cases/:id` | Authorized roles | Read one case and status history |
| `PATCH /cases/:id` | Dispatcher in review | Update permitted case fields and notes |
| `POST /cases/:id/review` | Dispatcher | Enter review, require follow-up, approve, or reject (`rejection_reason`) |
| `POST /cases/:id/follow-up-response` | Case customer | Answer a follow-up and return the case to review |
| `POST /cases/:id/cancel` | Case customer | Cancel before work starts (`cancellation_reason`, `cancelled_by`) |
| `GET /cases/:id/export` | Dispatcher | Backend-generated PDF of the case |

**Dependencies:** auth/identity/audit. `files` validates ownership before `cases` associates attachment IDs. `cases` owns lifecycle validation and uses audit/status history transactionally. A request stores `problem_type` and structured `intake_answers`.

**Testable outcome:** a customer can create equipment, upload evidence, submit a manual case, and view it; a dispatcher can review it, request clarification, approve, or reject it; a customer can cancel before work starts. Illegal state changes and cross-customer access fail.

The emergency form produces a request with `priority = EMERGENCY`, `is_safety_escalated = true`, `ai_analysis_status = SKIPPED`, and the selected `contact_preference`; it creates its case record at submission, does not enqueue AI work, and notifies all dispatchers with a `SAFETY_ESCALATED` notification at `URGENT` priority that includes any unpaid balance. A request whose assessed urgency is `HIGH` or `CRITICAL` is escalated the same way by the backend. The backend auto-generates the title. The hotline option is frontend-only and creates no request or case.

## 3. Dispatch and Notifications

**Purpose:** maintain technician eligibility and skills, compute deterministic rankings, assign technicians, and notify participants.

**Entities:** `technician_profiles`, `technician_skills`, `skills`, `teams`, `team_members`, `assignments`, `notifications`.

| Endpoint | Role | Purpose |
| --- | --- | --- |
| `PATCH /technicians/:id/availability` | Technician, Dispatcher | Toggle `is_available` |
| `GET /cases/:id/technician-ranking` | Dispatcher | Return eligible candidates, factors, weights, and score |
| `POST /cases/:id/assignments` | Dispatcher | Assign an eligible technician to an approved case, with notes and `scheduled_at` |
| `POST /assignments/:id/external` | Dispatcher | Record an external technician (name and phone) for an emergency case when no internal technician is available |
| `GET /assignments` | Dispatcher, Technician | List scoped assignments |
| `GET /notifications` | Authenticated | List own notifications |
| `PATCH /notifications/:id/read` | Owner | Mark own notification read (`read_at`) |

**Dependencies:** auth/identity/audit, cases. Ranking takes the request's priority and category plus technician data. Assignment requires `APPROVED` state and stores `ranking_snapshot`.

**Ranking.** NestJS alone computes it; AI may only present the stored factors. Eligibility is checked first: approved profile (`profile_status = APPROVED`), required skill, not payment-blocked, `is_available`, and no safety restriction. Weights:

| Factor | Normal | Emergency |
| --- | ---: | ---: |
| Skill | 30% | 30% |
| Availability | 30% | 40% |
| Experience | 15% | 15% |
| Feedback | 15% | 10% |
| Rate | 10% | 5% |

Availability scores 0 for a technician with an `ACCEPTED` or `IN_PROGRESS` assignment, regardless of `is_available`. The rate factor uses `emergency_rate` for `EMERGENCY` requests and `normal_rate` otherwise: `score = 1 - (rate - min) / (max - min)` across candidates, and `1.0` for everyone when `max = min`. Distance is not a factor in the MVP; the dispatcher considers location manually. Future directions are GPS tracking, a dispatcher map, distance ranking, and route optimization.

**Notifications.** MVP delivery is frontend polling every 30 seconds against `GET /notifications`. WebSockets and mobile push are future work.

## 4. Jobs, Billing, and Reviews

**Purpose:** technician execution, invoicing, cash-payment verification, commission, and customer feedback.

**Entities:** `job_reports`, `job_costs`, `attachments` (`INVOICE_PHOTO`), `reviews`, `case_feedback`, `commission_tiers`, `technician_ledger`.

| Endpoint | Role | Purpose |
| --- | --- | --- |
| `POST /assignments/:id/accept` | Assigned technician | `PENDING` to `ACCEPTED`; the request stays `ASSIGNED` |
| `POST /assignments/:id/reject` | Assigned technician | Reject with a reason; assignment `REJECTED`, request returns to `APPROVED` |
| `POST /assignments/:id/start` | Assigned technician | `ACCEPTED` to `IN_PROGRESS`; request becomes `IN_PROGRESS` |
| `POST /assignments/:id/job-report` | Assigned technician; Dispatcher for external assignments | Submit diagnosis, work done, parts, hours, and helpfulness; completes the job and creates the cost record |
| `GET /jobs/:caseId` | Assigned technician, Dispatcher, Customer, Manager | Read role-filtered job record |
| `GET /jobs/:caseId/cost` | Customer, Dispatcher, Manager | Read the cost breakdown and payment state |
| `POST /jobs/:caseId/invoice/confirm` | Customer; Dispatcher on the customer's behalf after 7 days without a customer response | Confirm the invoice (`invoice_status = CONFIRMED`) |
| `POST /jobs/:caseId/invoice/dispute` | Customer | Dispute with a reason |
| `POST /jobs/:caseId/payment/photo` | Assigned technician | Upload the paid-invoice photo; `payment_status = INVOICE_SUBMITTED` |
| `POST /jobs/:caseId/payment/confirm` | Dispatcher, Manager | Confirm payment after checking the photo |
| `POST /jobs/:caseId/payment/dispute` | Dispatcher, Manager | Mark a mismatch as `DISPUTED` |
| `POST /cases/:id/reviews` | Case customer | Submit one completion review (not for external jobs) |
| `POST /cases/:id/feedback` | Dispatcher | Record `is_accurate` and `approved_for_knowledge` in `case_feedback` |
| `PATCH /reviews/:id/visibility` | Manager | Hide or show a review |

**Cost calculation (backend):** internal jobs use `labor_cost = hours_worked x hourly_rate_used`, where the rate is `emergency_rate` for emergencies and `normal_rate` otherwise, plus `extra_visits x hourly_rate_used`. `parts_cost` is the sum over `parts_used`. `total_cost = labor_cost + parts_cost`; there is no base price. External jobs use the dispatcher-entered `manual_labor_cost` and leave hours and rate empty.

**Payment rules.** Cash only; no gateway. The customer, or the dispatcher on their behalf, confirms the invoice. After paying the technician in cash, the technician uploads a photo of the paid invoice. A dispatcher or manager confirms or disputes it; the photo is required before `CONFIRMED`; technicians cannot confirm. `has_unpaid_balance` is recomputed from the customer's jobs: true when any job has a confirmed invoice and a payment that is not `CONFIRMED` (including `DISPUTED`), false otherwise. While true, the customer cannot submit a normal or urgent request; an emergency request is accepted and flagged to the dispatcher.

**Commission.** For registered technicians only, commission is charged only when payment is confirmed (not on job completion and not on invoice confirmation): `commission_rate` of `labor_cost` (parts excluded) through a `technician_ledger` entry linked to the job cost. The ledger updates the technician's `outstanding_balance`; a manager records payments received. External jobs have no commission, ledger entry, or review.

**Completion must atomically** write the report, cost record, assignment and request status with history, and notifications. A failed notification must not roll back a valid completion.

## 4b. Technician Onboarding and Tiers

**Entities:** `technician_profiles` (`profile_status`), `technician_tier_requests`, `commission_tiers`.

| Endpoint | Role | Purpose |
| --- | --- | --- |
| `POST /technician-applications` | Technician applicant | Submit an initial application (`INITIAL_APPLICATION`) |
| `POST /technicians/:id/tier-requests` | Technician | Request a tier update (`TIER_UPDATE`) |
| `PATCH /technician-tier-requests/:id` | Manager | Decide: `TIER_CHANGED`, `SKILLS_NOTED_ONLY`, or `NO_CHANGE`; approving an application sets `profile_status = APPROVED` |

Tiers are `BRONZE`, `SILVER`, `GOLD`, each with a `commission_rate` and optional minimum rating, experience years, and completed jobs. Only `APPROVED` technicians are eligible for assignment.

## 5. AI Gateway

**Purpose:** expose one role-aware chat entry point, own conversations and runs, authorize controlled tools, submit worker jobs, and apply validated results without changing business authority.

**Entities:** `ai_conversations` (messages stored as JSON), `ai_runs` (with correlation ID and idempotency key), `ai_tool_calls`, `ai_feedback`.

| Endpoint | Role | Purpose |
| --- | --- | --- |
| `POST /ai/conversations` | Customer, Dispatcher, Technician, Manager | Start scoped conversation |
| `POST /ai/conversations/:id/messages` | Conversation owner | Submit chat message and enqueue eligible AI work |
| `GET /ai/runs/:id` | Conversation owner, Manager as authorized | Read pending/completed/failed result |
| `POST /ai/runs/:id/feedback` | Conversation owner | Submit a 1-5 rating and comment (one per user per run) |
| `POST /internal/ai-runs/:id/result` | Worker service only | Deliver validated contract result |
| `POST /internal/ai-runs/:id/tools/:name` | Worker service only | Run-scoped controlled tool call checked against the run's capability list; every call, including unauthorized ones, is written to `ai_tool_calls` and audited |

**Dependencies:** auth/identity/audit, cases, dispatch, jobs, files, queue. The gateway permits draft creation but never permits a worker callback to perform approval, assignment, or completion. Run states are `PENDING`, `IN_PROGRESS`, `COMPLETED`, `FAILED`.

## 6. Knowledge

**Purpose:** manage approved sources and RAG ingestion for the customer-side agent.

**Entities:** `knowledge_sources`, `knowledge_documents`, `knowledge_chunks`.

| Endpoint | Role | Purpose |
| --- | --- | --- |
| `POST /knowledge/sources` | Manager | Register curated source metadata |
| `POST /knowledge/sources/:id/documents` | Manager | Upload/register a document for ingestion |
| `PATCH /knowledge/sources/:id/status` | Manager | Activate or deactivate a source (`is_active`) |
| `GET /knowledge/sources` | Manager | Audit knowledge inventory and promoted cases |
| `POST /internal/knowledge/documents/:id/chunks` | Worker service only | Deliver extracted, embedded chunks; NestJS stores them and updates `processing_status` and `total_chunks` |

Promotion is triggered by the dispatcher's `approved_for_knowledge` feedback, not by a manager endpoint. The backend then creates a `CASE_REPORT` document linked by `source_job_report_id` and queues ingestion. Managers can deactivate promoted sources.

**Dependencies:** files, jobs, ai-gateway, audit, queue. Promotion verifies technician completion and the dispatcher approval before indexing; AI output can never trigger it.

## 7. Analytics

**Purpose:** deliver manager-scoped operational information through conventional dashboards and controlled AI analytics tools.

**Entities:** no new source of truth; reads requests, assignments, job costs, reviews, ai runs, ledger, and audit data.

| Endpoint | Role | Purpose |
| --- | --- | --- |
| `GET /analytics/operations` | Manager | Case volume, status, urgency, completion and assignment metrics |
| `GET /analytics/technicians` | Manager | Workload, outcomes, availability, feedback aggregates |
| `GET /analytics/ai` | Manager | Run success/failure, latency, feedback metrics |
| `GET /analytics/payments` | Manager | Confirmed revenue by period and category; pending, invoice-submitted, and disputed counts and totals; customers with unpaid balances |
| `GET /analytics/commission` | Manager | Technician outstanding balances and ledger summaries |

**Dependencies:** completed operations modules and ai-gateway. Analytics tools return aggregates or role-permitted records only. There is no separate reporting table.

## Module Risks

- Keep `cases` as the single lifecycle authority; avoid duplicate status-change code in dispatch or jobs.
- Notifications must not be a requirement for state changes.
- Recompute `has_unpaid_balance` from all of a customer's jobs inside the payment transaction, never toggle it.
- Invoice auto-confirmation after 7 days needs a scheduled job; build it as an explicit dispatcher action first.
- AI gateway endpoints need strict conversation-to-resource authorization, particularly for technicians and manager queries.
