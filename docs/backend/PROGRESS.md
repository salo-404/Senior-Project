# Backend Progress

What has been built, week by week. How the backend works is in `plan/08_backend_process.md`; the reasons behind decisions are in `docs/backend/BACKEND_DECISIONS.md`; the database is in `Data_Base_Plan/DB_Schema.md`.

Last updated: 2026-10-10. Branch: `system-design`.

## Summary

| Week | Theme | State |
| --- | --- | --- |
| Setup | Planning, design, database schema, migrations | Done |
| Week 1 | Infrastructure and users | Done, tested |
| Week 2 | Technicians, requests, cases (finalized) | Done, tested, pushed |
| Week 3 | Dispatch: ranking, assignment, external technician, row lock | Done, tested; the closing fix is not committed yet |
| Week 4 | Jobs, billing flows, reviews, reports | Not started |
| Later | AI module, knowledge base, Python worker | Not started |

Tests at the end of Week 3 (run on Windows): typecheck clean, 409 unit tests, 99 end-to-end tests, all passing, none skipped with Redis and storage running. The end-to-end tests use a throwaway database, never the dev one.

## Setup (before Week 1)

- Planning and system design documents, the database schema and the backend scaffold.
- Database migrations, in order:

| Migration | What it did |
| --- | --- |
| `init` | The first schema (33 tables), squashed from three earlier migrations |
| `schema_v4_fixes` | Commission precision, invoice lines, weekly schedule, visit-fee-only flag, language, unpaid-balance flag, indexes |
| `schema_v4_1_auth_and_summary` | Account activation columns, customer confirmation fields, `CASE_CONFIRMED_BY_CUSTOMER` audit action |
| `schema_v4_2_audit_and_activation_index` | More audit actions, unique index on the activation token |
| `schema_v4_3_case_updated` | `CASE_UPDATED` audit action (Week 2 finalization) |

## Week 1: infrastructure and users

Technical modules (`apps/backend/src/infra/`):

| Module | What it gives |
| --- | --- |
| `prisma` | Database access, transaction timeout setting |
| `audit` | One audit log used by every module, with the correlation id |
| `auth` | Login, 15-minute access token, 7-day rotating refresh cookie, argon2id passwords, roles guard |
| `queue` | Redis queue (BullMQ) for later AI jobs |
| `health` | Health check for database, Redis and storage |
| `safety` | The fixed safety question rules (a keyword never escalates by itself) |
| `notifications` | In-app notifications, sent after commit and never throwing |
| `storage` | Photo upload with type, size and resolution checks, signed links, delete |

Business module `users`:
- Profile, invite-only dispatcher and manager accounts, one-time activation, role change between dispatcher and manager, last-manager protection, unpaid-balance helpers.
- Public sign-up for customers; roles are never taken from a request body.

Also done: seed scripts (`npm run seed`, `npm run seed:reference`), error format, pagination format, request context, Docker compose for Postgres (pgvector), Redis and storage.

## Week 2: technicians, requests, cases

Technicians (`modules/technicians/`):
- Technician sign-up with an application template, manager approve or reject, re-apply.
- Availability switch, rates (`PATCH /technicians/:id/rates`), weekly schedule (`PUT /technicians/:id/schedule`), skills.
- Tier requests (`POST /technicians/me/tier-requests`, `GET /manager/tier-requests`, `POST /tier-requests/:id/decide`).
- Skills and teams catalogue (`POST /skills`, `POST /teams`, `POST /teams/:id/members`).
- Nightly tier suggestion at 02:00; it only proposes and never changes a tier.
- Commission tiers read through `billing/CommissionTiersService`.

Requests and equipment (`addresses`, `equipment`, `requests`):
- Addresses, equipment, normal, urgent and emergency requests, photos.
- An unpaid balance blocks normal and urgent requests; emergency passes with a flag.
- `POST /requests/:id/safety-confirm`: a clear "yes" escalates to EMERGENCY. A "yes" on the intake form does the same.

Cases (`modules/cases/`):
- List, details, dispatcher review and edits, follow-up questions, customer cancel.
- Every dispatcher edit is audited as `CASE_UPDATED` in the same transaction.
- Customer-confirmed summary: `GET /requests/:id/summary` and `POST /requests/:id/summary/confirm`. Possible causes and urgency are never shown to the customer.
- `CaseLifecycleService` is the only code that changes a request's status.

Pricing code (`billing/pricing/`): money in cents, labor, commission and invoice calculations. Built and tested, not connected to any route yet.

Tests added: unit tests next to the code, end-to-end suites (auth, users, technicians, cases, dispatch, stage 2 finalization), and smoke tests for real Redis and storage that skip with a message when the services are not running.

## Week 3: dispatch

Technician ranking and assignment (`modules/assignments/`):
- `GET /cases/:id/technician-ranking` (dispatcher only): every eligible technician with each factor, the weights, the score and the rate used, plus the excluded technicians with their reasons. The same input always gives the same ranking.
- Weights: normal and URGENT 30/30/15/15/10 (skill, availability, experience, feedback, rate); emergency 30/40/15/10/5.
- Availability is `1 - open/3`, and PENDING assignments count. A technician with 3 open assignments is excluded, and so is one who already rejected the case. Under 3 reviews, feedback is a neutral 0.6.
- `POST /cases/:id/assignments` (dispatcher only): only an APPROVED case can be assigned. The dispatcher may pick any eligible technician, and the ranking snapshot records `overridden`.
- The status change, assignment, audit row and snapshot are one transaction; notifications go out after commit to the technician and the customer.
- Two dispatchers on the same case: one wins. Two dispatchers on different cases for the same technician: a row lock on the technician keeps them at 3 open assignments or fewer (found by a failing test, then fixed).
- `POST /cases/:id/assignments/external` (dispatcher only): an external technician, name and phone only, for URGENT or EMERGENCY and only when no internal technician is eligible.
- `GET /assignments`: a technician sees their own, staff see all. A customer cancelling an assigned case cancels the open assignment and notifies the technician.

Tests: ranking unit tests, 21 dispatch end-to-end tests including the same-case race, the different-case race and a forced failure inside the assign transaction.

Not part of Week 3: the dispatcher workspace screens (frontend). Not tested yet: external jobs having no ledger entry or review, because billing and reviews are not built.

## Week 4: next

Not started. The planned work, from the status table in `plan/08_backend_process.md`:
1. Jobs: accept, reject, start, delay, job report.
2. Billing flows: invoice, customer confirmation, payment confirmation, commission ledger.
3. Reviews and technician stats (through the existing `ReviewStatsPort`).
4. Reports.

## Open items

- Add a `requested_skill_ids` column to tier requests in the next schema migration. Until then requested skills are stored as JSON in `supporting_notes`.
- The tests were run on Windows only. A Linux (WSL) run was not done and is not required for the local setup.
- The AI queue only stores jobs; no worker consumes them until the AI stage.
- A teammate's Windows machine with Smart App Control can block the argon2 native package.
