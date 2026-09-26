# NestJS Module Plan

## Build Order at a Glance

`01 auth/identity/audit -> 02 files/equipment/cases -> 03 dispatch/notifications -> 04 jobs/reviews -> 05 ai-gateway -> 06 knowledge -> 07 analytics`

Modules 1 and 2 below are intentionally self-contained, testable milestones. They establish a working manual platform before any queue, model, or RAG work begins.

## 1. Auth, Identity, and Audit (first self-contained milestone)

**Purpose:** authenticate users, enforce four roles, manage role profiles, and record critical actions.

**Entities:** `users`, `roles`, `user_roles`, role profiles, `audit_logs`.

| Endpoint | Role | Purpose |
| --- | --- | --- |
| `POST /auth/login` | Public | Issue JWT access token and refresh token/session |
| `POST /auth/refresh` | Authenticated | Refresh a valid session |
| `POST /auth/logout` | Authenticated | Revoke current session |
| `GET /me` | Authenticated | Return identity, roles, and own profile |
| `PATCH /me/profile` | Authenticated | Update own role-relevant profile fields |
| `GET /users/:id` | Dispatcher, Manager | Read permitted user/profile summary |
| `GET /audit-logs` | Manager | Read filtered audit records |

**Dependencies:** none for login/RBAC; audit is a shared dependency for later critical mutations.

**Testable outcome:** seed one account per role; verify login, token rejection, role guard behavior, self-only profile updates, and audited profile changes.

## 2. Files, Equipment, and Cases (second self-contained milestone)

**Purpose:** deliver the manual customer-to-dispatcher case workflow with no AI, queue, or technician assignment required.

**Entities:** `customer_addresses`, `equipment_types`, `equipment`, `maintenance_requests`, `maintenance_cases`, `case_status_history`, `attachments`.

| Endpoint | Role | Purpose |
| --- | --- | --- |
| `POST /files/uploads` | Customer, Technician | Begin authorized attachment upload and create metadata |
| `GET /files/:id` | Owner, authorized dispatcher/technician/manager | Resolve authorized access to an attachment |
| `POST /equipment` | Customer | Register owned equipment |
| `GET /equipment` | Customer | List own equipment |
| `POST /requests` | Customer | Submit a manual maintenance request |
| `GET /cases` | Customer, Dispatcher, Manager | List cases within role scope |
| `GET /cases/:id` | Authorized roles | Read one case and status history |
| `PATCH /cases/:id` | Customer before submission; Dispatcher in review | Update permitted case fields |
| `POST /cases/:id/review` | Dispatcher | Enter review, require follow-up, approve, or cancel |

**Dependencies:** auth/identity/audit. `files` validates ownership before `cases` associates attachment IDs. `cases` owns lifecycle validation and uses audit/status history transactionally.

**Testable outcome:** a customer can create equipment, upload metadata-backed evidence, submit a manual case, and view it; a dispatcher can review it, request clarification, approve, or cancel it. Illegal state changes and cross-customer access fail.

## 3. Dispatch and Notifications

**Purpose:** maintain technician eligibility/availability, compute deterministic rankings, assign technicians, and notify participants.

**Entities:** technician profile/skills/teams/availability, `assignments`, `notifications`.

| Endpoint | Role | Purpose |
| --- | --- | --- |
| `POST /technicians/:id/availability` | Technician, Dispatcher | Add/update availability according to policy |
| `GET /cases/:id/technician-ranking` | Dispatcher | Return eligible candidates, factors, weights, and score |
| `POST /cases/:id/assignments` | Dispatcher | Assign an eligible technician to an approved case |
| `GET /assignments` | Dispatcher, Technician | List scoped assignments |
| `GET /notifications` | Authenticated | List own notifications |
| `PATCH /notifications/:id/read` | Owner | Mark own notification read |

**Dependencies:** auth/identity/audit, cases. Ranking takes case category/urgency and technician data from the owning identity/dispatch service. Assignment requires `APPROVED` state and records its ranking snapshot.

## 4. Jobs and Reviews

**Purpose:** enable the technician execution workflow and collect customer feedback.

**Entities:** `job_reports`, optional job cost/parts tables when needed, `reviews`.

| Endpoint | Role | Purpose |
| --- | --- | --- |
| `POST /assignments/:id/accept` | Assigned technician | Move case to `IN_PROGRESS` |
| `POST /assignments/:id/job-report` | Assigned technician | Submit verified finding, work, outcome, and evidence |
| `GET /jobs/:caseId` | Assigned technician, Dispatcher, Customer, Manager | Read role-filtered job record |
| `POST /cases/:id/reviews` | Case customer | Submit one completion review |

**Dependencies:** cases, dispatch, files, audit, notifications. Completion must atomically write the report, status transition/history, and notifications.

## 5. AI Gateway

**Purpose:** expose one role-aware chat entry point, own conversations/runs, authorize controlled tools, submit worker jobs, and apply validated results without changing business authority.

**Entities:** `ai_conversations`, `ai_messages`, `ai_runs`, `ai_tool_calls`, `ai_feedback`.

| Endpoint | Role | Purpose |
| --- | --- | --- |
| `POST /ai/conversations` | Customer, Dispatcher, Technician, Manager | Start scoped conversation |
| `POST /ai/conversations/:id/messages` | Conversation owner | Submit chat message and enqueue eligible AI work |
| `GET /ai/runs/:id` | Conversation owner, Manager as authorized | Read pending/completed/failed result |
| `POST /ai/runs/:id/feedback` | Conversation owner | Submit feedback/correction |
| `POST /internal/ai-runs/:id/result` | Worker service only | Deliver validated contract result |

**Dependencies:** auth/identity/audit, cases, dispatch, jobs, files, queue. The gateway permits draft creation but never permits a worker callback to perform approval, assignment, or completion.

## 6. Knowledge

**Purpose:** manage approved sources and RAG ingestion for the customer-side agent.

**Entities:** `knowledge_sources`, `knowledge_documents`, `knowledge_chunks`.

| Endpoint | Role | Purpose |
| --- | --- | --- |
| `POST /knowledge/sources` | Manager | Register curated source metadata |
| `POST /knowledge/sources/:id/documents` | Manager | Upload/register a document for ingestion |
| `POST /knowledge/cases/:id/promote` | Manager | Promote a reviewed verified outcome as a proposed source |
| `PATCH /knowledge/sources/:id/status` | Manager | Approve, disable, or retire source |
| `GET /knowledge/sources` | Manager | Audit knowledge inventory |

**Dependencies:** files, jobs, ai-gateway, audit, queue. Promotion verifies technician completion and the required human approval before indexing.

## 7. Analytics

**Purpose:** deliver manager-scoped operational information through conventional dashboards and controlled AI analytics tools.

**Entities:** no new source of truth; reads cases, assignments, reports, reviews, AI run metrics, and audit data.

| Endpoint | Role | Purpose |
| --- | --- | --- |
| `GET /analytics/operations` | Manager | Case volume, status, urgency, completion and assignment metrics |
| `GET /analytics/technicians` | Manager | Workload, outcomes, availability, feedback aggregates |
| `GET /analytics/ai` | Manager | Run success/failure, latency, fallback, feedback metrics |

**Dependencies:** completed manual operations modules and ai-gateway. Analytics tools return aggregates or role-permitted records only.

## Module Risks

- Keep `cases` as the single lifecycle authority; avoid duplicate status-change code in dispatch or jobs.
- Avoid implementing notifications as a requirement for state changes. A failed notification must not roll back an already valid assignment or completion.
- AI gateway endpoints need strict conversation-to-resource authorization, particularly for technicians and manager queries.
