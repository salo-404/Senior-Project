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
| Intake safety key | `intake_answers.safety_concern` is a boolean; `true` means the customer answered Yes to the form's safety question. No other key is read. |
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
