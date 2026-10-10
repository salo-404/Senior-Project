# Backend Process

How the backend works today, what is built, and the rules a developer or an AI agent must keep when changing it. The locked design is `maintAIn_Backend_Plan.md`; the schema authority is `Data_Base_Plan/DB_Schema.md`; per-decision reasons are in `docs/backend/BACKEND_DECISIONS.md`. If this file and the code disagree, fix whichever is wrong in the same change.

Last updated: 2026-10-10.

## 1. Status

| Area | State |
| --- | --- |
| Infrastructure: prisma, audit, queue, health, safety, notifications, storage, auth | Built and tested |
| Users (profile, invite-only staff, activation, role change, unpaid balance helpers) | Built and tested |
| Technicians: signup with application template, manager approve or reject, re-apply, availability switch | Built and tested |
| Addresses, equipment, customer requests (normal, urgent, emergency), photos | Built and tested |
| Cases: list, details, dispatcher review, follow-up questions, customer cancel | Built and tested |
| Dispatch: technician ranking, assignment, external technician, assignment list | Built and tested |
| Pricing code (`billing/pricing`: money, labor, commission, invoice) | Built and tested, not yet connected to any route |
| Jobs (accept, reject, start, delay, report), billing flows, reviews, reports | Not built |
| AI module, knowledge base, Python worker | Not built (the manual path works without them) |

## 2. How one request is processed

1. A middleware gives the request a correlation id (kept from the `x-correlation-id` header when it is a UUID). Audit rows and log lines carry it.
2. `helmet`, `cookie-parser`, CORS (allowlist from `CORS_ORIGINS`), and the `/api/v1` prefix.
3. Guards, in this order: rate limit (`ThrottlerGuard`), authentication (`JwtAuthGuard`, every route unless `@Public()`), roles (`RolesGuard`, from `@Roles(...)`).
4. `ValidationPipe` with `whitelist` and `forbidNonWhitelisted`: unknown fields are rejected, so a `role` in a body never reaches the code.
5. The controller only validates input, calls one service method and returns.
6. The service does everything else: ownership check, business rules, and one database transaction for anything that changes status, money or balances. The transaction also writes the history and audit rows.
7. After the transaction commits, notifications are sent. A failed notification never rolls back business data and never throws.
8. Errors leave as `{ "error": { "code", "message", "details" } }`; lists as `{ "data": [...], "meta": { "page", "pageSize", "total" } }`.

A role check is not an ownership check. The guard knows the caller is a customer; the service must also check the record is theirs. A record that belongs to someone else returns 404, never 403.

## 3. Code layout (`apps/backend/src`)

| Folder | Holds |
| --- | --- |
| `config/` | Environment validation. The app refuses to start without the required variables. |
| `common/` | Error filter, pagination, request context (correlation id), password and token helpers, `Db` type. |
| `infra/` | Technical modules: `prisma`, `audit`, `queue`, `health`, `safety`, `notifications`, `storage`, `auth`. |
| `modules/` | Business modules: `users`, `technicians`, `addresses`, `equipment`, `requests`, `cases`, `assignments`, `billing/pricing`. |
| `modules/jobs`, `knowledge`, `reviews`, `skills`, `teams` | Empty stubs for later stages (names may be changed when built). |

One owner per table: a module never reads another module's tables, it calls that module's exported service. `CaseLifecycleService` (in `cases/`) is the only code that changes a request's status. `AuditService.log` always receives the caller's transaction.

## 4. Accounts and sign-in

- Public sign-up creates a Customer (`POST /auth/register`) or a technician applicant (`POST /auth/register/technician`). The role is set by the backend.
- Dispatcher and Manager accounts are invite-only. A manager creates an inactive user (`POST /users`); a one-time activation token (stored hashed, expires in 48 hours) is returned once; the invitee sets their own password at `POST /auth/activate`. The first manager comes from `npm run seed`.
- Passwords use argon2id. Login gives a 15-minute access token and a 7-day refresh token in an httpOnly, Secure, SameSite=Strict cookie on `/api/v1/auth`. Refresh tokens rotate; reusing a revoked one ends every session of that user.
- A technician whose profile is `PENDING_REVIEW` or `REJECTED` can log in and sees only their application status.
- Manager rules: never on yourself; role change only between dispatcher and manager; the last active manager cannot be demoted or deactivated.

## 5. Case lifecycle

A customer submission becomes a request with a `MANUAL` case record. `status` is the business lifecycle; `ai_analysis_status` is separate and is `SKIPPED` on the manual path.

| From | To | Who | Rule |
| --- | --- | --- | --- |
| none | `NEW` | Customer submits | Normal or urgent: detailed form. Emergency: short form. Unpaid balance blocks normal and urgent; emergency passes with a flag. |
| `NEW` | `UNDER_REVIEW` | Dispatcher (`START`) | The dispatcher is now checking the case directly. |
| `NEW` | `APPROVED` | Dispatcher (`APPROVE`) | **EMERGENCY only.** The emergency form already holds what is needed, so review is skipped. Any other priority gets 409 `INVALID_TRANSITION`. |
| `NEW` or `UNDER_REVIEW` | `REJECTED` | Dispatcher (`REJECT`) | A reason is required and is shown to the customer. |
| `UNDER_REVIEW` | `REQUIRES_FOLLOW_UP` | Dispatcher | The question is saved on the case. |
| `REQUIRES_FOLLOW_UP` | `UNDER_REVIEW` | Customer answers | |
| `UNDER_REVIEW` | `APPROVED` | Dispatcher (`APPROVE`) | Sets `verified_by` and `verified_at`; audits `CASE_VERIFIED`. |
| `APPROVED` | `ASSIGNED` | Dispatcher assigns | Created in the same transaction as the assignment. |
| `NEW`, `UNDER_REVIEW`, `REQUIRES_FOLLOW_UP`, `APPROVED` or `ASSIGNED` | `CANCELLED` | Customer, with a reason | An open assignment is cancelled in the same transaction and the technician is notified. Never once work has started. |

`COMPLETED`, `CANCELLED` and `REJECTED` are terminal. `ASSIGNED -> APPROVED` (technician rejects), `ASSIGNED -> IN_PROGRESS` and `IN_PROGRESS -> COMPLETED` are in the table for the jobs stage, which is not built. The visit-fee path (`IN_PROGRESS -> CANCELLED` by a dispatcher) is also not built yet.

Every change goes through `CaseLifecycleService.transition`: it validates the move, updates with `WHERE status = <from>` (two parallel changes cannot both win; the loser gets 409 `CASE_CHANGED`), and writes `request_status_history` and the audit row in the caller's transaction.

An emergency, or a dispatcher-assessed urgency of `HIGH` or `CRITICAL`, sets `is_safety_escalated` once and notifies every dispatcher. A keyword never escalates by itself; only the form's `safety_concern: true` or a confirmed danger does.

## 6. Dispatch and technician ranking

Only an `APPROVED` case can be ranked or assigned. The ranking is computed by plain backend code (`assignments/ranking/ranking.calculator.ts`, pure and deterministic); AI never ranks or assigns.

**Left out of the ranking entirely** (the dispatcher sees the reasons):

| Reason | Meaning |
| --- | --- |
| `ACCOUNT_INACTIVE` | The user account is deactivated. |
| `NOT_AVAILABLE` | `is_available` is false. |
| `PAYMENT_BLOCKED` | The technician owes commission. |
| `MISSING_SKILL` | No skill in the case's category. |
| `TOO_MANY_ACTIVE_JOBS` | Already 3 open assignments (`PENDING`, `ACCEPTED` or `IN_PROGRESS`). |
| `REJECTED_THIS_CASE` | This technician already rejected this case. |

Only technicians with `profile_status = APPROVED` are considered; applicants never appear.

**Score** (each factor 0 to 1, weighted, times 100):

| Factor | Value | Normal | Emergency |
| --- | --- | ---: | ---: |
| Skill | best proficiency in the case category / 5 | 30% | 30% |
| Availability | `1 - openAssignments / 3` | 30% | 40% |
| Experience | `years / 10`, capped at 1 | 15% | 15% |
| Feedback | `rating / 5`; **fewer than 3 reviews gives a neutral 0.6** | 15% | 10% |
| Rate | cheapest = 1, dearest = 0, all equal = 1; emergency rate for EMERGENCY, normal rate otherwise | 10% | 5% |

URGENT uses the normal weights. Ties break by more experience, then the lower rate, then id, so the same input always gives the same order.

**Assigning:** the dispatcher may pick any listed technician, not only the top one. In one transaction the case is claimed (`APPROVED -> ASSIGNED`, conditional), the assignment is created `PENDING` with `ranking_snapshot` (the ranking the dispatcher saw, the weights, the choice, `overridden` and an optional note), and an audit row is written. After commit the technician and the customer are notified. Two dispatchers clicking at the same moment cannot both assign.

**External technician:** `POST /cases/:id/assignments/external`, EMERGENCY cases only, and only when the ranking is empty (no internal technician can take it). It records a name and phone, no profile or login, status `ACCEPTED`, and no commission, ledger or review will follow.

## 7. Routes (all under `/api/v1`)

| Group | Routes | Who |
| --- | --- | --- |
| Auth | `POST /auth/register`, `/auth/register/technician`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/activate`; `POST /auth/change-password`, `GET /auth/me` | Public, except the last two (signed in) |
| Health | `GET /health` | Public |
| Users | `GET` and `PATCH /users/me`; `POST /users`, `GET /users`, `PATCH /users/:id/deactivate`, `PATCH /users/:id/role` | Signed in; the rest manager only |
| Notifications | `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/read-all`, `PATCH /notifications/:id/read` | Signed in, own only |
| Attachments | `GET /attachments/:id/url` | Uploader, the request's customer, dispatcher, manager |
| Technicians | `GET /skills` (public); `GET /technician-applications/mine`, `POST /technician-applications/reapply`; `PATCH /technicians/:id/availability`; `GET /technician-tier-requests`, `GET` and `PATCH /technician-tier-requests/:id` | Technician; availability also dispatcher; tier requests manager |
| Addresses, equipment | `GET`, `POST`, `PATCH /addresses`; `GET /equipment-types`; `GET`, `POST`, `PATCH /equipment` | Customer (equipment types: any signed-in user) |
| Requests | `POST /requests`, `POST /requests/emergency`, `POST /requests/:id/photos` | Customer |
| Cases | `GET /cases`, `GET /cases/:id`; `PATCH /cases/:id`, `POST /cases/:id/review`; `POST /cases/:id/follow-up-response`, `POST /cases/:id/cancel` | Reading: customer (own), dispatcher, manager. Edit and review: dispatcher. Answer and cancel: customer. |
| Dispatch | `GET /cases/:id/technician-ranking`, `POST /cases/:id/assignments`, `POST /cases/:id/assignments/external`; `GET /assignments` | Dispatcher; the list also technician (own) and manager |

## 8. Testing process

| Command (from `apps/backend`) | What it runs |
| --- | --- |
| `npm test` | Unit tests next to the code (`*.spec.ts`). No database needed. |
| `npm run test:e2e` | End-to-end tests in `test/` against a throwaway database. |
| `npm run seed` | Creates the first manager from `SEED_MANAGER_EMAIL` and `SEED_MANAGER_PASSWORD`. |
| `npm run seed:reference` | Skills, commission tiers and equipment types. |

How e2e isolation works, and why:

- `test/global-setup.ts` creates a database named `maintain_e2e_<random>` on the server in `DATABASE_URL`, applies every migration to it, and `global-teardown.ts` drops it. The development database is never touched.
- All e2e files share that one database, and most create users with the same emails (`custA@test.dev`, `dispatcher@test.dev`, ...). Before each file, `test/e2e-clean-db.ts` empties every table (`TRUNCATE ... CASCADE`, keeping only the migrations table), so the files cannot collide and can run in any order. It refuses to run against a database that is not a `maintain_e2e_*` one.
- Jest needs `--experimental-vm-modules` because NestJS 12 is ESM-only; the npm scripts set it.
- Every e2e file runs with `AI_ENABLED=false`, no Redis and no object storage, so the manual path is proven to work without them.

Expected result: 305 unit tests and 67 e2e tests pass.

## 9. Changes made when Stage 2 and 3 were reviewed against the plan

The first versions of the stage 2 and stage 3 code (written on `feature/stage2-equipment-cases`) differed from the backend plan. The plan won; the code was changed, and the changed places carry `NOTE(plan-alignment ...)` comments.

| What | Before | Now (the plan) | Where |
| --- | --- | --- | --- |
| Availability score | 0 or 1; only `ACCEPTED` or `IN_PROGRESS` counted | `1 - open / 3`; `PENDING` also counts | `ranking.calculator.ts`, `assignments.service.ts` |
| Job limit | none | A technician with 3 open assignments is excluded (`TOO_MANY_ACTIVE_JOBS`) | `ranking.calculator.ts` |
| Neutral feedback | 0.5, for technicians with no reviews | 0.6, for technicians with fewer than 3 reviews | `ranking.calculator.ts` |
| Rejected the case | not checked | Excluded from that case (`REJECTED_THIS_CASE`) | `ranking.calculator.ts`, `assignments.service.ts` |
| "No internal technician is available" (external technician rule) | no technician with a free job | the ranking is empty | `assignments.service.ts` |
| Emergency approval | had to go through `UNDER_REVIEW` | Approved straight from `NEW`; `NEW -> REJECTED` also allowed | `case-lifecycle.service.ts` |
| E2E tests | files collided on duplicate emails when run together | database emptied before each file | `test/e2e-clean-db.ts`, `test/jest-e2e.config.js` |

Rules for the next developer or agent:

- Do not change the weights, the 3-job limit, the 0.6 neutral feedback or the emergency shortcut without changing the backend plan, `DB_Schema.md` section 6 and this file together.
- A new status change must go through `CaseLifecycleService.transition`. Never update `maintenance_requests.status` directly.
- A new e2e file may use any emails: the database is emptied before it runs. It must not rely on rows left by another file.
- Do not edit or delete applied Prisma migrations; add a new one.

## 10. Open items

- **External technician for URGENT cases.** The backend plan (7.2) says URGENT or EMERGENCY; `plan/00_system_overview.md` and `DB_Schema.md` say emergencies only. The code allows EMERGENCY only. Decide and align the documents.
- **Visit-fee cancellation** (`IN_PROGRESS -> CANCELLED` by a dispatcher with a visit-fee invoice) is not in the lifecycle table yet; it belongs with the jobs and billing stages.
- **Jobs stage:** technician accept, reject (returns the case to `APPROVED`), start, delay, report. Rejecting will be what `REJECTED_THIS_CASE` reacts to.
- **Attachments:** the assigned technician cannot open case photos until the jobs stage.
- **Object storage and Redis** are not exercised by the e2e tests (uploads are only tested up to the clean 503 when storage is down).
- **Empty module stubs** (`jobs`, `knowledge`, `reviews`, `skills`, `teams`) do not match the plan's module names and should be renamed or removed when those stages start.
- **Lockfiles:** the tracked `apps/backend/package-lock.json` is stale; the repo uses the root lockfile.
