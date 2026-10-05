# Security Plan

## Security Objectives

1. Only authenticated users can access protected data or operations.
2. Role and resource ownership are enforced by NestJS on every API and AI tool call.
3. AI receives the minimum information and capability required for one scoped run.
4. Files are never public by default and are served only after backend authorization.
5. Critical actions are traceable to a user, worker run, and request context.

## JWT and Session Setup

- Use short-lived JWT access tokens and refresh tokens stored only as hashes in `refresh_tokens`, revoked (`is_revoked`) on logout or account deactivation.
- Put stable user ID, active role, and token ID in claims (the schema has no token-version column); do not put profile data, permission decisions, or sensitive details in the token.
- Validate signature, expiration, issuer/audience policy, active user status, and session revocation on protected requests.
- Rotate refresh tokens on use and invalidate all sessions after a password/security event according to policy.
- Apply rate limits and generic errors to login to reduce account enumeration and brute-force exposure.

## RBAC and Resource Checks

| Rule | Enforcement |
| --- | --- |
| Four application roles | NestJS role guard at route/controller level |
| Ownership boundaries | Service-level query filters and explicit resource authorization before read/write |
| Customer scope | Own profile, addresses, equipment, requests, cases, attachments, invoices, reviews, and conversations only |
| Dispatcher scope | Operational cases, permitted technician data, review/assignment functions, payment confirmation, job feedback and knowledge-promotion approval; no manager-only governance actions |
| Technician scope | Own profile, availability switch, commission balance, and active or historical authorized assignments/jobs only; cannot confirm or dispute payments |
| Manager scope | Approved aggregates, audit/knowledge governance; individual records only when a defined endpoint permits them |
| State changes | Lifecycle service verifies role, current state, active assignment, and required fields |

Do not depend on role-specific navigation alone. The server is the authority, and every Prisma query that touches owned data must include its ownership/assignment constraint.

## AI Permission Enforcement

1. NestJS creates every AI run with actor, active role, conversation, resource scope, allowed capability list, and correlation ID.
2. Python receives a narrow contract and authenticated run-scoped access, never database credentials or a full user token.
3. Each worker tool request reaches a NestJS tool endpoint that validates the run, capability, actor role, resource scope, schema, and rate/usage policy.
4. Tool calls are logged in `ai_tool_calls` and audited with the `AI_TOOL_CALL` action; critical domain reads/writes are audited. Each run has a correlation ID, and the worker's credential is short-lived and bound to that run.
5. The worker can save only an eligible case draft/result. It has no tools for approving, assigning, changing lifecycle status, completing jobs, changing roles, or broad data search.
6. NestJS validates worker result contracts and applies only allowed, non-authoritative outcomes. A model instruction cannot expand capabilities.

## Audit Strategy

Write append-only audit records for:

- login/logout/session revocation and account activation changes;
- role/profile changes and technician skill/availability changes;
- case creation, lifecycle changes, cancellation, assignment, acceptance, start, rejection, job-report completion, invoice confirmation (including on behalf of a customer), invoice photo submission, payment confirmation or dispute, and commission charges and payments;
- attachment upload/association/access denials as appropriate;
- knowledge-source status changes and verified-case promotion;
- AI run initiation/completion/failure, tool calls, fallback, and human feedback.

Each record contains actor type/ID, action, entity type/ID, correlation/request ID, timestamp, and a redacted before/after or result summary. Do not store raw secrets, access tokens, or unnecessary image/document content in the audit trail.

## File and Image Access

- Store files in object storage using non-guessable object keys; store metadata and ownership in PostgreSQL.
- Require NestJS authorization before any upload, view, download, or worker evidence access.
- Verify content type and file size and reject unsupported files. The schema has no scan-status column, so any malware scanning must happen before the attachment row is created.
- Invoice photos are attachments with `purpose = INVOICE_PHOTO`; only the assigned technician may upload one and only a dispatcher, manager, the customer, or that technician may view it.
- Use short-lived, single-object authorized operations when the client or worker must transfer a file. Do not expose a bucket-wide credential or permanent public URL.
- Enforce attachment-to-case/request ownership and scope before association. A client-provided attachment ID alone is insufficient.
- Remove or redact sensitive metadata from images where feasible before promoting a case outcome into the knowledge base.

## Input and Data Protection

- Validate all REST bodies, query parameters, route IDs, queue payloads, AI tool inputs, and worker callbacks with typed schemas.
- Use parameterized Prisma access only; never build SQL or vector filters from raw client/LLM strings.
- Escape/render chat and report content safely in the frontend to prevent stored script injection.
- Separate client-visible error messages from internal error logs; preserve correlation IDs for support.
- Protect secrets through environment configuration and least-privileged service credentials. Do not commit secrets or embed them in queue payloads.

## Security Tests

| Test | Expected result |
| --- | --- |
| Customer requests another customer's case or attachment | `403`/not-found according to disclosure policy |
| Technician tries to complete an unassigned case | Rejected by assignment and lifecycle checks |
| Dispatcher assignment request uses an ineligible technician | Rejected with eligibility reason |
| Worker requests an unauthorized tool/case | Rejected and logged |
| Worker callback attempts `APPROVED` or `ASSIGNED` change | Rejected; no lifecycle mutation |
| Expired/revoked token is used | Rejected |
| Duplicate AI job/callback is delivered | Idempotency check prevents duplicate draft/result effect |
| Attachment ID from another customer is attached to a new request | Rejected |
| Technician tries to confirm payment, or confirm without an invoice photo | Rejected |
| Technician uploads an invoice photo for another technician's job | Rejected |
| Customer with an unpaid balance submits any request, including an emergency | Rejected |
| Worker connects directly to PostgreSQL | No credentials exist; connection refused |

## Security Risks to Resolve Before Production

- Retention and ethics (decided): collect only what a job needs; keep chats and images 12 months after job completion and audit logs 3 years without personal content; delete or anonymize on a customer's request; never train models on customer data; label AI output as a suggestion. Implement the deletion jobs before production.
- Compromised accounts (decided): a manager can deactivate a user and revoke all of their refresh tokens at once; JWT and worker secrets are rotated on a schedule and whenever a leak is suspected. Write the runbook before production.
- Define moderation/escalation handling for unsafe customer messages and potentially hazardous image content without allowing AI to act as an emergency authority.
