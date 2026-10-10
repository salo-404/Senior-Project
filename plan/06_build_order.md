# Build Order

Each stage must have migration coverage where applicable, API tests for authorization and domain rules, and a small end-to-end happy path before the next stage begins. Do not begin AI work until the manual operational path is working.

## 1. Foundation: Auth, RBAC, Profiles, Audit

**Depends on:** nothing.

Build:

1. NestJS application structure and Prisma connection to PostgreSQL.
2. `users`, `user_roles` (role enum), `refresh_tokens`, `customer_profiles`, `technician_profiles`, and `audit_logs` schema.
3. JWT login/refresh/logout, current-user endpoint, guards, decorators, and seeded four-role test users.
4. Profile updates with audit records.

Done when: every role can sign in; unauthenticated, wrong-role, and cross-user profile requests are rejected; audit records exist for critical profile/session actions.

## 2. Manual Case Workflow: Files, Equipment, Cases

**Depends on:** Module 1 only.

Build:

1. Object-storage integration boundary and attachment metadata/access checks.
2. Equipment type and customer equipment APIs.
3. Manual maintenance request and maintenance case creation.
4. Case lifecycle service, status history, customer/dispatcher case lists, and dispatcher review/follow-up/approval/cancellation actions.
5. Customer and dispatcher frontend screens for the manual flow.

Done when: a customer can create equipment, submit a manual report with permitted evidence, and see the resulting case; a dispatcher can review, ask for clarification, approve, or cancel it; every state change is validated and recorded. No AI, Redis, BullMQ, Python, or RAG is required for this milestone.

## 3. Dispatch: Technician Data, Ranking, Assignment, Notifications

**Depends on:** Modules 1 and 2.

Build:

1. Technician onboarding (application, approval, tier requests), skills, teams, the availability switch, and eligibility rules.
2. Deterministic eligibility and normal/emergency ranking service (30/30/15/15/10 and 30/40/15/10/5) with factor-level explanation payload and priority-aware rate.
3. Assignment transaction with schedule, ranking snapshot, dispatcher confirmation, and notification records.
4. Dispatcher assignment workspace and technician assignment list.

Done when: only an approved case can be assigned; the system returns explainable backend scores; a dispatcher can override the top recommendation with any eligible technician; the assignment appears for the technician.

## 4. Technician Execution and Customer Review

**Depends on:** Module 3.

Build:

1. Technician accept, reject, and start workflow, including return of a rejected request to `APPROVED`.
2. Job report submission with verified outcome and completion evidence.
3. Atomic completion transition, history, audit record, notifications, and backend cost calculation (labor from the dual rate, parts from the report, no base price).
   Invoice confirmation by the customer or dispatcher, technician paid-invoice photo upload, dispatcher/manager payment confirm or dispute, recomputation of the unpaid-balance block, and commission ledger charges.
4. Emergency external-technician assignment and dispatcher-entered job report.
5. Customer review eligibility and one-review constraint (skipped for external jobs).
6. Dispatcher case feedback (`case_feedback`: accuracy and approval for knowledge).
7. Technician workspace, dispatcher payment screen, and customer completion/review UI.

Done when: an assigned technician can accept and complete a job; their verified outcome is persisted and visible to authorized users; a customer can review a completed case.

## 5. AI Platform Boundary: Redis, BullMQ, AI Gateway, Worker Skeleton

**Depends on:** Modules 1 through 4.

Build:

1. Redis/BullMQ setup and versioned run/job contract.
2. `ai_conversations` (messages stored as JSON), `ai_runs`, and `ai_feedback` tables (already in the schema); decide where tool calls are recorded.
3. NestJS AI gateway with conversation/resource authorization and pending/failed result states.
4. Python worker skeleton, controlled backend tool client, correlation IDs, Pydantic contract validation, retries, and failure callbacks.
5. Frontend shared chat run-state component with a non-AI fallback link to manual forms/actions.

Done when: a harmless test job moves from queued to succeeded/failed with audited records, unauthorized tool calls are rejected, and the web UI displays pending and failure states without blocking manual work.

## 6. Customer AI and Initial RAG

**Depends on:** Module 5 and the manual customer workflow in Module 2.

Build:

1. Approve initial curated knowledge sources and establish document provenance fields.
2. Implement extraction, chunking, embedding, pgvector storage, and filtered similarity retrieval.
3. Implement Agent 1 prompts, follow-up flow, image analysis path, structured case-draft schema, and citation validation.
4. Implement editable customer draft review and explicit submission into the existing manual case pipeline.
5. Exercise AI outage, invalid output, unavailable RAG, and safety-limited flows.

Done when: a customer can obtain an editable, cited draft; the draft cannot bypass normal case submission/review; unsupported or failed AI work cleanly falls back to manual reporting.

## 7. Dispatcher and Technician AI Support

**Depends on:** Modules 3, 4, and 5; dispatcher Agent 2 does not depend on RAG.

Build:

1. Operations Agent with read-only ranking/case tools and explanation schema.
2. Technician job-scoped assistant with strict assignment scope and grounded retrieval where allowed.
3. Frontend chat configurations for dispatcher and technician roles.
4. Tests proving neither agent can assign, approve, transition, or complete a case.

Done when: dispatchers can understand a backend-generated ranking and technicians can request job-scoped guidance, while all operational actions remain ordinary server-authorized UI/API actions.

## 8. Manager Analytics and Knowledge Governance

**Depends on:** Modules 4 through 7.

Build:

1. Aggregate operational/technician/AI run analytics endpoints.
2. Manager chat routing to controlled analytics tools.
3. Knowledge source governance (activate/deactivate) and review of promoted verified cases. Promotion itself is gated by the dispatcher's feedback approval from stage 4.
4. Payment analytics, and audit, provenance, and feedback reporting screens.

Done when: a manager can inspect metrics and govern knowledge sources, with promotion and every source change fully audited; AI-generated content alone cannot become trusted knowledge.

## Cross-Stage Release Gates

| Before moving past | Required proof |
| --- | --- |
| 1 | Authentication/RBAC/audit API tests pass |
| 2 | Manual customer-to-dispatcher workflow works end to end |
| 3 | Assignment uses deterministic ranking and preserves a snapshot |
| 4 | Verified completion is authoritative and review is constrained |
| 5 | Queue contract, authorization, retries, and manual fallback are tested |
| 6 | RAG citations/provenance and invalid-output handling are tested |
| 7 | AI cannot make protected operational changes |
| 8 | Knowledge promotion and manager analytics are auditable |

## Build Risks

- Choose the first narrow vertical slice deliberately: one supported category, one standard urgency flow, and the manual path. Expanding category coverage before lifecycle correctness will slow the team.
- The AI worker should be introduced only after stable case, assignment, and job contracts exist; otherwise its tool interfaces will churn.

## Decision Log

| Date | Decision |
| --- | --- |
| September 2026 | MVP categories are HVAC/Air Conditioning and home appliances (fridges, washing machines, dishwashers) for indoor spaces; plumbing, electrical, and generators are future directions. |
| September 2026 | NestJS-only technician ranking uses the confirmed normal and emergency weights. |
| September 2026 | Qwen is the current shared-agent model plan; Ollama versus online API, plus embeddings, remain implementation decisions; no MVP fine-tuning. |
| September 2026 | Dispatchers and managers share `staff_profiles`; their role difference stays in `user_roles`. |
| September 2026 | Emergency form requests bypass AI and notify dispatch immediately; hotline display creates no case. |
| September 2026 | Dispatchers provide technician-case feedback after reviewing job reports; technicians record AI helpfulness in their own reports. |
| September 2026 | Customers choose manual form entry or AI-assisted form filling and always submit themselves; dispatchers gain PDF export and job setup flow. |
| September 2026 | The Orchestrator is the central chat for all roles; it routes to the two agents or controlled manager analytics tools. |
| September 2026 | MVP notifications poll every 30 seconds; WebSockets and mobile push are future work. |
| September 2026 | Required operational, audit, notification, conversation, and pgvector indexes are specified. |
| September 2026 | Vector dimension fixed at 1024 (BGE-M3); HNSW index chosen over ivfflat. |
| October 2026 | Payment is business-facing: cost calculation and display only, no gateway, manual confirmation by the dispatcher, and an unpaid balance blocks new requests including emergencies. |
| October 2026 | Technicians are company employees; for urgent or emergency cases, when no internal technician is available, the dispatcher may record an external technician (name and phone only, no profile or login, no commission/ledger/review, manual labor cost, dispatcher-filled job report). Freelancer marketplace is future work. |
| October 2026 | Location tracking is future work; distance is not a ranking factor; availability weight rises to 30% (normal) and 40% (emergency). |
| October 2026 | `EMERGENCY` priority uses a simplified fast intake form; `URGENT` uses the normal detailed form. |
| October 2026 | Schema v2 adopted as the single authority: 32 tables in 12 domains (the earlier "38" was a counting error). Dual hourly rate (`normal_rate`, `emergency_rate`); cash payment with invoice photo verification; commission tiers and technician ledger; technician applications and tier requests; assignment statuses `PENDING`, `ACCEPTED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `REJECTED`; ranking weights 30/30/15/15/10 (normal) and 30/40/15/10/5 (emergency); availability via `is_available`; no base price; the `roles`, `staff_profiles`, `technician_availability`, `job_parts`, `service_prices`, `ai_messages`, and `ai_tool_calls` tables removed. |
| October 2026 | Decisions finalized: unpaid balance blocks normal and urgent requests but emergencies pass with a dispatcher flag; assessed urgency `HIGH` or `CRITICAL` escalates to emergency; manager approves technician applications and tier requests; the technician enters hours; extra visits are billed as one hour each; a dispatcher may confirm an invoice on a customer's behalf after 7 days; commission is charged only on payment confirmation; emergencies create their case at submission; actor columns are foreign keys; one commission charge per job; every attachment has exactly one parent; `contact_preference` is nullable; enum types are snake_case and timestamps are `timestamptz`; `ai_tool_calls`, correlation ID, idempotency key, and login/logout/AI-tool-call audit actions added (33 tables); the worker uses a short-lived run-scoped credential; local Ollama Qwen with the online Qwen API as fallback; one central chat with role-scoped routing; image analysis stays advisory until evaluated; verified-case text is de-identified before embedding; retention is 12 months for chats and images and 3 years for audit logs; storage is S3-compatible (RustFS locally, Cloudflare R2 free tier deployed); notifications poll every 30 seconds; a root npm workspace is added. |
| October 2026 | Documentation reconciliation: `DB_Schema.md` is the schema authority; the worker has no database credentials (NestJS serves retrieval and stores ingested chunks); the dispatcher's feedback approval is the sole knowledge-promotion gate; customers cancel up to `ASSIGNED`, dispatchers `REJECT`; technician accept and start are separate steps; HNSW replaces ivfflat. |
