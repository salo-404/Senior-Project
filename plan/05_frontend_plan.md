# Frontend Plan

## Application Shape

Use one Next.js application with authenticated role-aware routes and shared API client/auth state. The first usable release prioritizes the complete manual flow. AI controls are additive and never replace a form, lifecycle action, or dispatcher decision.

## Customer Pages

Customer request entry offers two deliberate paths: fill the form manually, or open AI chat and press **Let AI Fill Form** after describing the issue. AI fills editable standard form fields; the customer always reviews, edits if needed, and submits. AI never submits a request for the customer.

| Page | Main components | API integration |
| --- | --- | --- |
| Sign in | Login form, validation, session handling | `POST /auth/login`, `GET /me` |
| Customer dashboard | Case status list, quick report entry, notifications | `GET /cases`, `GET /notifications` |
| New manual request | Equipment selector, address selector, symptom/category fields, urgency/safety inputs, image uploader | `GET/POST /equipment`, `POST /files/uploads`, `POST /requests` |
| AI-assisted report | Chat thread, attachment picker, draft preview, edit/review/submit controls, AI run status | `POST /ai/conversations`, `POST /ai/conversations/:id/messages`, `GET /ai/runs/:id` |
| Emergency request | Simplified EMERGENCY-only form with registered equipment picker, pre-filled/changeable default address, short description, contact preference, optional photo, auto-generated title, immediate dispatcher notice, hotline number display | `POST /requests/emergency` for the form; the hotline creates no backend request |
| Case detail | Status timeline, evidence, dispatcher follow-up, assignment/job summary as permitted | `GET /cases/:id`, `PATCH /cases/:id` |
| Completed case/review | Verified outcome summary, invoice with confirm/dispute actions, payment status, review form | `GET /jobs/:caseId`, `GET /jobs/:caseId/cost`, `POST /jobs/:caseId/invoice/confirm`, `POST /jobs/:caseId/invoice/dispute`, `POST /cases/:id/reviews` |
| Cancel / follow-up | Cancel with reason; answer a dispatcher follow-up | `POST /cases/:id/cancel`, `POST /cases/:id/follow-up-response` |

The customer sees a clear distinction between their description, AI-suggested fields, dispatcher communication, and verified technician outcome.

The simplified Emergency form is triggered only when the customer selects `EMERGENCY`. It uses equipment already registered to the customer, pre-fills the default address while allowing changes, accepts a short free-text description, offers `FORM` or `HOTLINE` as `contact_preference`, and allows an optional photo. The backend generates a title such as `Emergency - [equipment type]`; the customer does not enter a title. Customers with `has_unpaid_balance = true` are blocked from normal and urgent requests, but emergencies are allowed and flagged to the dispatcher. Normal and `URGENT` requests continue using the normal detailed form; `URGENT` is only sorted higher in the dispatcher queue.

## Emergency Intake Form

When priority is `EMERGENCY`, show a separate simplified form containing:

- Quick equipment picker limited to the customer's already-registered equipment; there is no add-new-equipment flow here.
- Address pre-filled from the customer's default address and changeable.
- One short free-text description field.
- `contact_preference`: `FORM` or `HOTLINE`.
- Optional photo attachment.
- Backend-generated title, for example `Emergency - [equipment type]`.

The unpaid-balance block does not apply to emergencies; the dispatcher sees the unpaid balance as a flag on the request. Normal non-emergency requests, including `URGENT`, keep the detailed request form.

## Dispatcher Pages

Dispatchers review each case in a structured page and can export it as a backend-generated PDF. Available review actions are approve, reject, and request more information. After approval, the dispatcher creates the technician job by adding notes, selecting an eligible technician, and setting a schedule.

| Page | Main components | API integration |
| --- | --- | --- |
| Dispatcher queue | Filters by status, urgency, category; compact case rows | `GET /cases` |
| Case review | Full report/evidence, history timeline, follow-up panel, approve/reject/request-more-information actions, PDF export | `GET /cases/:id`, `POST /cases/:id/review`, `GET /cases/:id/export` |
| Assignment workspace | Candidate table, eligibility messages, score-factor breakdown, selected technician confirmation | `GET /cases/:id/technician-ranking`, `POST /cases/:id/assignments` |
| Payment verification | Job report, cost breakdown, uploaded invoice photo, **Confirm Payment** and **Dispute** buttons, confirm-invoice-on-behalf action | `GET /jobs/:caseId/cost`, `POST /jobs/:caseId/invoice/confirm`, `POST /jobs/:caseId/payment/confirm`, `POST /jobs/:caseId/payment/dispute` |
| Job feedback | Completed job report review: was the AI cause accurate, approve for knowledge | `POST /cases/:id/feedback` |
| Operations chat | Case-aware chat, AI ranking explanation, run state | AI conversation/run endpoints |
| Technician directory | Skill, team, availability switch, tier, feedback summaries | technician endpoints defined by dispatch module |

Dispatcher payment workflow: after job completion, show the work report, labor and parts breakdown, total amount due, invoice status, the technician's invoice photo, and the confirm or dispute controls. A mismatched photo is disputed and flagged on the manager dashboard. External-technician labor cost is entered manually by the dispatcher, who also fills that job's report.

The assignment screen must make the human confirmation action separate from the recommendation. The dispatcher can inspect scores and choose a different eligible technician.

## Technician Pages

The technician assistant is limited to case summaries, possible causes, required tools, and on-site findings reported by the technician. It uses only authorized job information and RAG knowledge, supports technician judgment, and never makes decisions.

| Page | Main components | API integration |
| --- | --- | --- |
| My assignments | Current and scheduled assignments, accept/reject actions, status | `GET /assignments`, `POST /assignments/:id/accept`, `POST /assignments/:id/reject` |
| Job workspace | Case/equipment summary, evidence viewer, start action, execution checklist, outcome report form | `GET /jobs/:caseId`, `POST /assignments/:id/start`, `POST /assignments/:id/job-report` |
| Job assistant | Job-scoped chat, case summary, possible-cause and tool guidance | AI conversation/run endpoints |
| Availability | On/off availability switch | `PATCH /technicians/:id/availability` |
| Paid invoice photo | Camera/upload for the signed or paid invoice after the customer pays cash | `POST /jobs/:caseId/payment/photo` |
| Tier and commission | Current tier, tier-update request form, outstanding commission balance and ledger | `POST /technicians/:id/tier-requests`, `GET /analytics/commission` (own scope) |

The technician cannot change another technician's assignment, alter the case history, or use the assistant outside an authorized job scope.

## Manager Pages

| Page | Main components | API integration |
| --- | --- | --- |
| Operations dashboard | Case volume/status, response and completion metrics, technician workload, AI reliability metrics | `GET /analytics/operations`, `GET /analytics/technicians`, `GET /analytics/ai` |
| Payments dashboard | Confirmed revenue by period and category, pending/invoice-submitted/disputed counts and totals, customers with unpaid balances; confirm or dispute payment | `GET /analytics/payments`, `POST /jobs/:caseId/payment/confirm`, `POST /jobs/:caseId/payment/dispute` |
| Technician onboarding | Pending applications and tier requests, decide outcome, view commission ledgers, record received payments | `PATCH /technician-tier-requests/:id`, `GET /analytics/commission` |
| Review moderation | Hide or show a review | `PATCH /reviews/:id/visibility` |
| Manager chat | Analytics question input, grounded result display, source/time range labels | AI conversation/run endpoints and manager tools |
| Knowledge governance | Source list, document state, promoted verified cases, activate/deactivate controls | knowledge endpoints |
| Audit view | Filterable critical-action history | `GET /audit-logs` |

Customer view after job completion includes the work performed summary, cost breakdown (labor plus parts), total amount due, invoice status (`Pending Confirmation`, `Confirmed`, `Disputed`), payment status (`Pending`, `Invoice Submitted`, `Confirmed`, `Disputed`), and a notice that payment is made in cash to the technician.

## Shared Components

- App shell with role-aware navigation and current identity.
- Session guard and role guard for every protected route.
- API client that attaches tokens, handles unauthorized responses, and maps backend validation errors.
- Status badge and case timeline based on backend status enum.
- Evidence uploader/viewer that uses authorized file operations only.
- Notification center.
- Reusable loading, empty, retry, and permission-denied states.

## AI Chat Interface Plan

The shared chat surface has role-specific capability configuration rather than a generic free-for-all chat.

1. Create or resume a conversation with role and resource scope.
2. Submit text and attachment IDs; immediately render the user's message and a pending run state.
3. Poll/read the run result and render one of: assistant response, draft fields for user review, recommendation explanation, follow-up questions, limited result, or manual fallback notice.
4. Show source/citation references for RAG-derived customer and technician answers when present.
5. For AI-generated case drafts, provide editable standard fields and a deliberate customer submit action.
6. Never show controls that imply the AI approved a case, assigned a technician, or confirmed a diagnosis.

## Frontend Risks

- Do not rely on frontend route hiding for security; every screen action must be backed by a server-side role/resource check.
- Define polling versus notification-driven AI result updates before building chat. The API contract should support either without changing UI result states.
- Evidence thumbnails and error states must not leak objects that the current user cannot access.
