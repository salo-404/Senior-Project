# Frontend Plan

## Application Shape

Use one Next.js application with authenticated role-aware routes and shared API client/auth state. The first usable release prioritizes the complete manual flow. AI controls are additive and never replace a form, lifecycle action, or dispatcher decision.

## Customer Pages

<!-- Updated: UI/UX flow decisions -->

Customer request entry offers two deliberate paths: fill the form manually, or open AI chat and press **Let AI Fill Form** after describing the issue. AI fills editable standard form fields; the customer always reviews, edits if needed, and submits. AI never submits a request for the customer.

| Page | Main components | API integration |
| --- | --- | --- |
| Sign in | Login form, validation, session handling | `POST /auth/login`, `GET /me` |
| Customer dashboard | Case status list, quick report entry, notifications | `GET /cases`, `GET /notifications` |
| New manual request | Equipment selector, address selector, symptom/category fields, urgency/safety inputs, image uploader | `GET/POST /equipment`, `POST /files/uploads`, `POST /requests` |
| AI-assisted report | Chat thread, attachment picker, draft preview, edit/review/submit controls, AI run status | `POST /ai/conversations`, `POST /ai/conversations/:id/messages`, `GET /ai/runs/:id` |
| Emergency request | Minimal description and location form, immediate dispatcher notice, hotline number display | `POST /requests/emergency` for the form; the hotline creates no backend request |
| Case detail | Status timeline, evidence, dispatcher follow-up, assignment/job summary as permitted | `GET /cases/:id`, `PATCH /cases/:id` |
| Completed case/review | Verified outcome summary and review form | `GET /jobs/:caseId`, `POST /cases/:id/reviews` |

The customer sees a clear distinction between their description, AI-suggested fields, dispatcher communication, and verified technician outcome.

## Dispatcher Pages

<!-- Updated: UI/UX flow decisions -->

Dispatchers review each case in a structured page and can export it as a backend-generated PDF. Available review actions are approve, reject, and request more information. After approval, the dispatcher creates the technician job by adding notes, selecting an eligible technician, and setting a schedule.

| Page | Main components | API integration |
| --- | --- | --- |
| Dispatcher queue | Filters by status, urgency, category; compact case rows | `GET /cases` |
| Case review | Full report/evidence, history timeline, follow-up panel, approve/cancel actions | `GET /cases/:id`, `POST /cases/:id/review` |
| Assignment workspace | Candidate table, eligibility messages, score-factor breakdown, selected technician confirmation | `GET /cases/:id/technician-ranking`, `POST /cases/:id/assignments` |
| Operations chat | Case-aware chat, AI ranking explanation, run state | AI conversation/run endpoints |
| Technician directory | Skill, team, availability, feedback summaries | technician/availability endpoints defined by dispatch module |

The assignment screen must make the human confirmation action separate from the recommendation. The dispatcher can inspect scores and choose a different eligible technician.

## Technician Pages

<!-- Updated: UI/UX flow decisions -->

The technician assistant is limited to case summaries, possible causes, required tools, and on-site findings reported by the technician. It uses only authorized job information and RAG knowledge, supports technician judgment, and never makes decisions.

| Page | Main components | API integration |
| --- | --- | --- |
| My assignments | Current and scheduled assignments, accept action, status | `GET /assignments`, `POST /assignments/:id/accept` |
| Job workspace | Case/equipment summary, evidence viewer, execution checklist, outcome report form | `GET /jobs/:caseId`, `POST /assignments/:id/job-report` |
| Job assistant | Job-scoped chat, case summary, possible-cause and tool guidance | AI conversation/run endpoints |
| Availability | Availability editor | `POST /technicians/:id/availability` |

The technician cannot change another technician's assignment, alter the case history, or use the assistant outside an authorized job scope.

## Manager Pages

| Page | Main components | API integration |
| --- | --- | --- |
| Operations dashboard | Case volume/status, response and completion metrics, technician workload, AI reliability metrics | `GET /analytics/operations`, `GET /analytics/technicians`, `GET /analytics/ai` |
| Manager chat | Analytics question input, grounded result display, source/time range labels | AI conversation/run endpoints and manager tools |
| Knowledge governance | Source list, document state, case-promotion review, approval controls | knowledge endpoints |
| Audit view | Filterable critical-action history | `GET /audit-logs` |

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
