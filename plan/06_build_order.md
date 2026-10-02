# Build Order

Each stage must have migration coverage where applicable, API tests for authorization and domain rules, and a small end-to-end happy path before the next stage begins. Do not begin AI work until the manual operational path is working.

## 1. Foundation: Auth, RBAC, Profiles, Audit

**Depends on:** nothing.

Build:

1. NestJS application structure and Prisma connection to PostgreSQL.
2. `users`, `roles`, `user_roles`, role-profile, session/refresh, and `audit_logs` schema.
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

1. Technician profile enrichment, skills, teams, availability, and active-status rules.
2. Deterministic eligibility and normal/emergency ranking service with factor-level explanation payload.
3. Assignment transaction, ranking snapshot, dispatcher confirmation, and notification records.
4. Dispatcher assignment workspace and technician assignment list.

Done when: only an approved case can be assigned; the system returns explainable backend scores; a dispatcher can override the top recommendation with any eligible technician; the assignment appears for the technician.

## 4. Technician Execution and Customer Review

**Depends on:** Module 3.

Build:

1. Technician accept/start workflow.
2. Job report submission with verified outcome and completion evidence.
3. Atomic completion transition, history, audit record, and notifications.
4. Customer review eligibility and one-review constraint.
5. Technician workspace and customer completion/review UI.

Done when: an assigned technician can accept and complete a job; their verified outcome is persisted and visible to authorized users; a customer can review a completed case.

## 5. AI Platform Boundary: Redis, BullMQ, AI Gateway, Worker Skeleton

**Depends on:** Modules 1 through 4.

Build:

1. Redis/BullMQ setup and versioned run/job contract.
2. `ai_conversations`, `ai_messages`, `ai_runs`, `ai_tool_calls`, and feedback schema.
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
3. Knowledge source management and verified-case promotion approval flow.
4. Audit, provenance, and feedback reporting screens.

Done when: a manager can inspect metrics and approve/reject knowledge promotion with a complete audit trail; AI-generated content alone cannot become trusted knowledge.

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

## Decision Updates - October 2026

<!-- Updated: October 2026 decision register -->

Decision 1: Payment is business-facing - cost calculation and display only, no payment gateway, manual confirmation by dispatcher, blocks new requests (including emergencies) when a customer has an unpaid balance.

Decision 2: Technician model is company employees primary, emergency external technician support added (name + phone only, no system profile, cannot log in, closed one-off engagement) - no commission/ledger/review for external jobs, labor cost entered manually, job report filled by dispatcher. Freelancer marketplace = future.

Decision 3: Location tracking moved to future, distance is not part of the ranking algorithm, Availability weight increased to 30% (normal) / 40% (emergency).

Decision 4: EMERGENCY-priority requests use a simplified, faster intake form; URGENT uses the normal detailed form.

## Recent Decision Updates

<!-- Updated: September 2026 decision register -->

| Date | Decision update |
| --- | --- |
| September 2026 | MVP categories are HVAC/Air Conditioning and home appliances for indoor spaces; plumbing, electrical, and generators are future directions. |
| September 2026 | NestJS-only technician ranking uses the confirmed normal and emergency weights. |
| September 2026 | Qwen is the current shared-agent model plan; Ollama versus online API, plus embeddings, remain implementation decisions; no MVP fine-tuning. |
| September 2026 | Dispatchers and managers share `staff_profiles`; their role difference remains in `user_roles`. |
| September 2026 | Emergency form requests bypass AI and notify dispatch immediately; hotline display creates no case. |
| September 2026 | Dispatchers provide technician-case feedback after reviewing job reports; technicians record AI helpfulness in their own reports. |
| September 2026 | Customers choose manual form entry or AI-assisted form filling and always submit themselves; dispatchers gain PDF export and job setup flow. |
| September 2026 | The Orchestrator is the central chat for all roles; it routes to the two agents or controlled manager analytics tools. |
| September 2026 | MVP notifications poll every 30 seconds; WebSockets and mobile push are future work. |
| September 2026 | Required operational, audit, notification, conversation, and pgvector indexes are now specified. |
