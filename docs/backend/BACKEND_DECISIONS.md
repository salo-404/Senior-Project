# Backend Decisions

## Schema v4 changes

Migration `schema_v4_fixes`. Columns and indexes only; the table count stays at 33. Full detail is in `Data_Base_Plan/DB_Schema.md`.

| Change | Reason |
| --- | --- |
| `commission_tiers.commission_rate` and `technician_ledger.rate_applied` widened to `Decimal(5,2)` | `Decimal(3,2)` tops out at 9.99, so a rate of 10.00 overflowed. Rates are percentages: `10.00` means 10%. Ratings and `min_rating` stay `Decimal(3,2)`. |
| `job_costs.invoice_lines` (JSONB, nullable) | Freezes the exact lines the customer confirms (`LABOR`, `EXTRA_VISIT`, `PART`, `VISIT_FEE`, each with `amountCents`). Nullable in the database; the service sets it when the invoice is submitted. |
| `technician_profiles.weekly_schedule` (JSONB, nullable) | Per-day availability windows without a new table. Null means no schedule, treated as always available while `is_available = true`. |
| `job_costs.is_visit_fee_only` (default false) | Lets a cancelled assignment carry a visit fee that follows the normal invoice, payment, and commission flow. It uses `hours_worked = 1` and the priority rate, so `job_costs_billing_source_check` is unchanged. Service logic is not implemented yet. |
| `maintenance_requests.language` | Records the customer's language (detected or chosen); case text is stored in English. |
| `maintenance_requests.customer_had_unpaid_balance` | Captured at submission so the dispatcher sees the emergency unpaid-balance flag without recomputing it. |
| Indexes on `maintenance_requests(equipment_id, created_at)`, `job_costs(invoice_status, payment_status)`, `notifications(user_id, created_at)` | Repeat-problem detector, manager payment summaries, and the notification feed. |
| `notifications.request_id` foreign key `ON DELETE SET NULL` | Notifications are never deleted, so they must survive a deleted request. The `init` migration already had this behavior; v4 makes it explicit in the Prisma relation. |

## Schema v4.1 changes

Migration `schema_v4_1_auth_and_summary`. Details are in `Data_Base_Plan/DB_Schema.md`.

| Change | Reason |
| --- | --- |
| `users.activation_token_hash`, `users.activation_expires_at` | Staff accounts are invite-only: a manager creates an inactive user and a one-time activation link is issued. Only the token hash is stored, and the link expires after 48 hours. |
| `maintenance_cases.customer_confirmed_at`, `maintenance_cases.customer_note` | The customer confirms the AI summary or writes a correction. A correction never lowers urgency or removes safety flags. |
| `audit_action` value `CASE_CONFIRMED_BY_CUSTOMER` | Audits the customer's confirmation of the summary. |

## Schema v4.2 changes

Migration `schema_v4_2_audit_and_activation_index`.

| Change | Reason |
| --- | --- |
| `audit_action` values `USER_ROLE_CHANGED`, `ACCOUNT_ACTIVATED`, `ATTACHMENT_DELETED` | Role changes, account activation and attachment deletion are security-relevant, so each gets its own action instead of a generic one. |
| Unique index on `users.activation_token_hash` | Activation finds the user by the token hash through an index instead of scanning the table. |

## Week 1 decisions

Infrastructure modules (prisma, audit, queue, health, safety, notifications, storage, auth) and the users module.

| Topic | Decision |
| --- | --- |
| Technician registration | `POST /auth/register` creates a Customer only and rejects any `role` in the body (400). Technician sign-up is a separate route, `POST /auth/register/technician`, which returns 501 until the technicians module is built in Week 2. |
| Audit action names | The schema's names are used: `LOGIN`, `LOGIN_FAILED`, `LOGOUT` (not `USER_LOGIN` and similar). Role change is `USER_ROLE_CHANGED`, activation is `ACCOUNT_ACTIVATED`, attachment deletion is `ATTACHMENT_DELETED`. |
| Refresh cookie | `refresh_token`, `httpOnly`, `Secure`, `SameSite=Strict`, path `/api/v1/auth` (the API prefix is part of the path). |
| `TechnicianProfileStatusPort` | Auth never reads `technician_profiles`. It asks this port for a technician's profile status. A default implementation returns null; the technicians module implements the port in Week 2. |
| Attachment access | The uploader and dispatchers or managers can open an attachment (signed link, 5 minutes); anyone else gets 404. Only the uploader or a manager can delete one. The request's customer and the assigned technician get access when the requests and dispatch modules exist. Uploads must be JPEG, PNG or WebP, at most 10 MB and at least 320x240 pixels; EXIF metadata is removed. |
| `changeRole` limits | Managers only. Never on yourself (403). Only between dispatcher and manager, and only for staff accounts (409 otherwise). The last active manager cannot be demoted or deactivated (409). Access tokens issued before the change keep the old roles until they expire (15 minutes). |
| Session revocation | Refresh tokens rotate on every use. Presenting an already-revoked refresh token revokes every session of that user (treated as theft). Changing a password revokes every session. Deactivation stops refresh immediately; the access token lapses within 15 minutes. |
| Invited staff passwords | An invited account is created inactive with a random password hash that nobody knows, because `users.password_hash` is NOT NULL. The manager never sets or sees a password; the invitee sets their own when activating. |
| Intake safety key | `intake_answers.safety_concern` is a boolean; `true` means the customer answered Yes to the form's safety question. No other key is read. A Yes on the form raises the priority to EMERGENCY, the same as a confirmed `safety-confirm` (decided in Week 2 finalization). |
| E2E database warning | `npm run test:e2e` creates and drops a throwaway `maintain_e2e_*` database on the server named in `apps/backend/.env` `DATABASE_URL` (or `E2E_ADMIN_DATABASE_URL`). It never touches the dev database, but the Postgres user needs permission to create databases, and the server must be running. Never point it at a production server. |


## Technician signup and applications (technicians module)

Replaces the 501 stub of `POST /auth/register/technician`. Needs the reference data from `npm run seed:reference` (skills and commission tiers).

| Topic | Decision |
| --- | --- |
| Signup | `POST /auth/register/technician` takes the same account fields as `/auth/register` plus an `application` object: `skills` (ids from `GET /skills` with a 1-5 proficiency), `years_of_experience`, `bio`, requested `normal_rate` and `emergency_rate`, optional `proposed_tier` and `supporting_notes`. The job categories applied for are derived from the chosen skills. It creates the TECHNICIAN account, a `PENDING_REVIEW` profile and an `INITIAL_APPLICATION` in one transaction. No session is issued; the applicant logs in normally. |
| While pending or rejected | The applicant can log in and read `GET /technician-applications/mine` (status, manager's `review_notes`). The session already carries `technicianProfileStatus` through `TechnicianProfileStatusPort`, now implemented by the technicians module. Eligibility for work still requires `APPROVED`. |
| Manager decision | `GET /technician-tier-requests` (paginated, `?status=`), `GET /technician-tier-requests/:id`, `PATCH /technician-tier-requests/:id` with `decision` `APPROVED` or `REJECTED`. Approving grants a tier (`final_tier`, else the proposed tier, else BRONZE) and may adjust the rates; rejecting requires `review_notes`. A conditional update makes a second decision return 409 `ALREADY_DECIDED`. Audited as `TECHNICIAN_APPROVED` / `TECHNICIAN_REJECTED`. |
| Re-apply | `POST /technician-applications/reapply` (technician, only while `REJECTED`) takes the same template, replaces the skills, moves the profile back to `PENDING_REVIEW` and adds a new `INITIAL_APPLICATION`. Earlier applications stay on record. Otherwise 409 `NOT_REJECTED`. |
| Tier requests | Only `INITIAL_APPLICATION` is handled; `TIER_UPDATE` requests are refused (400 `NOT_AN_APPLICATION`) until that flow is built. |
| Reference data | `npm run seed:reference` upserts 7 skills (HVAC, home appliances) and the BRONZE/SILVER/GOLD tiers. The commission rates (15, 12, 10 percent) are placeholders until the business confirms them. |

## Stage 2 and 3 decisions (requests, cases, dispatch)

Code is on `feature/stage2-equipment-cases`. The reviewed and aligned version is described in `plan/08_backend_process.md`.

| Topic | Decision |
| --- | --- |
| One place for status changes | `CaseLifecycleService.transition` validates the move against an allowed table, updates with `WHERE status = <from>` (a parallel change gets 409 `CASE_CHANGED`), and writes the status history and the audit row in the caller's transaction. Nothing else may update `maintenance_requests.status`. |
| Emergency approval | UNDER_REVIEW means the dispatcher is checking a case directly. An EMERGENCY case may be approved straight from `NEW` (no `START` step); any other priority gets 409 `INVALID_TRANSITION`. A case may be rejected from `NEW` or `UNDER_REVIEW`, with a reason. |
| Submissions | `POST /requests` (NORMAL, URGENT; blocked by an unpaid balance) and `POST /requests/emergency` (short form, generated title, always accepted, unpaid balance only flagged). Both create a `MANUAL` case in the same transaction. Only `intake_answers.safety_concern === true` escalates. Dispatchers are notified after commit. |
| Photos | Customer only, own case, while the case is `NEW`, `UNDER_REVIEW` or `REQUIRES_FOLLOW_UP`, at most 5 per case. The customer who owns the request can open every photo on it. |
| Cancelling | The customer may cancel until `ASSIGNED`. An open assignment is cancelled in the same transaction and the technician is notified. |
| Ranking | See `plan/08_backend_process.md` section 6. Pure code; the dispatcher may override the top pick; the ranking and the override are stored in `assignments.ranking_snapshot`. |
| External technician | EMERGENCY only, and only when no internal technician is eligible. Open question: the backend plan also allows URGENT. |

## Plan alignment changes (stage 2 and 3 review)

The stage 2 and 3 code differed from the backend plan in the places below. The plan won; each changed place has a `NOTE(plan-alignment)` comment.

| Change | Reason |
| --- | --- |
| Availability is `1 - open assignments / 3`, and `PENDING` assignments count | Backend plan section 7.1. The earlier 0-or-1 score ignored a technician's real workload. |
| A technician with 3 open assignments is excluded (`TOO_MANY_ACTIVE_JOBS`) | Backend plan section 7.1 (limit of 3, a config value). |
| Feedback is a neutral 0.6 below 3 reviews (was 0.5 below 1) | Backend plan section 7.1: one or two reviews are not a reliable rating. |
| A technician who rejected a case is excluded from it (`REJECTED_THIS_CASE`) | Backend plan section 7.1. It will matter once technicians can reject in the jobs stage. |
| "No internal technician available" now means the ranking is empty | The external-technician rule needed a definition consistent with the 3-job limit. |
| `NEW -> APPROVED` (emergency only) and `NEW -> REJECTED` added to the lifecycle | Backend plan section 6.3: an emergency skips review. |
| `DB_Schema.md` section 6 updated to match | The schema document and the plan must say the same thing. |
| E2E files no longer collide: the database is emptied before each file | All e2e files share one throwaway database and reuse test emails. Each file passed alone, but the full run failed with a unique-constraint error on `email`. |

## Schema v4.3 changes

Migration `schema_v4_3_case_updated`.

| Change | Reason |
| --- | --- |
| `audit_action` value `CASE_UPDATED` | A dispatcher's edit of a case changes what the customer's case says, so it is audited with the old and new values instead of passing silently. |

## Week 2 finalization

Finishes the Week 2 items that were still open: the customer's summary, the remaining technician functions, URGENT external assignments, the case-edit audit, and smoke tests for storage and Redis. Nothing existing was rebuilt.

| Topic | Decision |
| --- | --- |
| Customer summary routes | `GET /requests/:id/summary` and `POST /requests/:id/summary/confirm` are in the cases module (`CaseSummaryController`) but mounted under `/requests`, because the customer thinks in requests. Customer only; someone else's request is a 404. |
| What the summary shows | Device, problem, symptoms and the customer's safety answer. Never possible causes, urgency or AI reasoning: the query does not even select them. Built from the case; when there is no case, from a fixed template over `intake_answers`. |
| Confirming | `{ confirmed: true }` or `{ confirmed: false, note }` sets only `customer_confirmed_at` and `customer_note`, and audits `CASE_CONFIRMED_BY_CUSTOMER`, in one transaction. It never lowers urgency and never removes a safety flag. A closed case (completed, cancelled, rejected) answers 409. The dispatcher's case view shows `customer_confirmation`: `CONFIRMED`, `CORRECTED` (with the note) or `NOT_CONFIRMED`; it never blocks anything. |
| Danger words in a correction | `safety.evaluateText` on the note: a hit only adds `safety_check` (the fixed confirmation question, in the customer's language) to the response. It never escalates by itself. |
| `POST /requests/:id/safety-confirm` | `{ answer: "yes" or "no" }`. Only a clear "yes" escalates through the existing escalate path and additionally raises the priority to EMERGENCY; dispatchers are notified after commit. "no" does nothing; a second "yes" is harmless. Requests escalated earlier through the intake form's `safety_concern` keep their priority (existing behavior). |
| Skills | The schema has no "proposed" state for a skill. A technician proposes skills through a TIER_UPDATE request (`skillIds`); the manager confirms them with outcome `SKILLS_NOTED_ONLY` (added at proficiency 1) or edits them directly with `PUT /technicians/:id/skills` (manager only; this route was added beyond the route list because `setSkills` needs one). |
| Tier requests | `POST /technicians/me/tier-requests` (approved technician, one open request at a time), `GET /manager/tier-requests`, `POST /tier-requests/:id/decide`. `TIER_CHANGED` updates `current_tier_id` and audits `TIER_CHANGED`. `SKILLS_NOTED_ONLY` adds the requested skills and leaves the tier and commission alone. `NO_CHANGE` closes the request as `REJECTED` and needs a reason. Anything but `TIER_CHANGED` is audited as `USER_UPDATED`. The technician is notified. A second decision is 409 `ALREADY_DECIDED`. |
| Where the requested skills are stored | `technician_tier_requests` has no skills column, so a TIER_UPDATE keeps `{ notes, skill_ids }` as JSON text in `supporting_notes` (`tier-request-payload.ts`). Schema gap: a `requested_skill_ids` column would remove this. |
| Commission tiers | Technicians read tier data only through `billing/CommissionTiersService` (read-only, lowest tier first). The earlier direct reads in the technicians module were moved to it. |
| Rates | `PATCH /technicians/:id/rates`, manager only, validated (at least 0.01, at most 2 decimals, emergency rate not below the normal rate), audited with old and new values. The ranking reads the profile, so it uses the new rate at once. |
| Weekly schedule | `PUT /technicians/:id/schedule`. A technician sets their own, a manager anyone's (another technician's profile is a 404). Days `mon`..`sun`, windows `{ from, to }` as `HH:MM`, `from` before `to`, no overlaps, at most 4 windows per day. An invalid schedule is 422 with every problem listed; `null` clears it. The ranking does not read it. |
| Skills and teams | `POST /skills`, `POST /teams`, `POST /teams/:id/members` (manager). Only an approved technician can join a team; `team_members.user_id` is the technician's user id. There is no audit action for catalogue changes, so they are not audited. The empty `skills/` and `teams/` folders were removed. |
| `updateStats` | `TechnicianProfileService.updateStats(profileId, tx)` recomputes `rating` and `total_reviews` through a `ReviewStatsPort`. The reviews module (Stage 4) provides the port; until then it returns "not available" and nothing changes, so an early call cannot reset a rating. |
| Nightly tier suggestion | `TierSuggestionJob` runs at 02:00 and proposes a TIER_UPDATE when a technician meets every threshold of the NEXT tier (rating, years of experience and completed jobs). A tier with any empty threshold is skipped, and so is a technician who already has a request waiting. It only proposes; it never changes a tier. Completed jobs come from `AssignmentsService.countCompleted`. |
| External technician | Now allowed for URGENT as well as EMERGENCY cases (backend plan 7.2), still only when no internal technician is eligible. A NORMAL case is refused with `EXTERNAL_NOT_ALLOWED` (this code replaces `EXTERNAL_ONLY_FOR_EMERGENCY`). |
| Case edits | Every dispatcher edit is audited as `CASE_UPDATED` with the old and new values, in the same transaction, before any escalation, so a failure afterwards rolls back both. |
| Smoke tests | `test/infra-smoke.e2e-spec.ts` runs against the Docker Redis and object storage (`docker compose up -d redis storage`): an image upload round trip (upload, signed link, other customer gets 404, delete) and `enqueueCaseDraft` really enqueuing a job that waits in the queue. Each is skipped with a message when its service is not running; it never fails for that reason. |
