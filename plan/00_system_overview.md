# maintAIn System Overview

## Purpose

maintAIn is an AI-powered maintenance management platform. It turns a customer report into a structured maintenance case while preserving human authority over all operational decisions. It supports the full workflow from a report through dispatch, job execution, technician verification, and operational insight.

The MVP service scope is HVAC/Air Conditioning and home appliances: fridges, washing machines, and dishwashers. The focus is indoor spaces: homes, offices, universities, and schools. Plumbing, electrical, and generators are future directions only and are not part of the MVP.

## Terms

A **request** is the raw customer submission and carries the lifecycle status. A **case** is the structured record built from it. The API and UI say "case" for the combined view; see `plan/02_database_schema.md`.

## Roles

| Role | Primary responsibility | Authority |
| --- | --- | --- |
| Customer | Report a problem, provide evidence, review a generated draft, track progress, review completed work | Creates and edits their own request before submission |
| Dispatcher | Review cases, request clarification, approve/reject, assign technicians, manage exceptions, confirm invoices on a customer's behalf, verify payment photos, give job feedback | Final authority for approval and assignment |
| Technician | Accept or reject assigned work, execute it, report findings and outcome, upload the paid-invoice photo | Verified job outcome is the authoritative service record |
| Manager | Monitor operations and finances, ask approved analytics questions, govern knowledge sources, hide reviews, record technician commission payments | Reviews metrics and verified operational data; can also confirm or dispute payments |

Technician model: the primary model is company-contracted technicians registered in the system. A technician applies and is approved (`profile_status`), holds skills, teams, a commission tier (`BRONZE`, `SILVER`, `GOLD`), an `is_available` switch, and two hourly rates (`normal_rate` and `emergency_rate`). Dispatchers and managers are plain users with roles and no separate profile. For super urgent emergency cases only, when all internal technicians are occupied or unavailable, the dispatcher may record an external technician by name and phone only. External engagement is a closed, one-off transaction handled directly by the dispatcher; the external technician has no system profile and cannot log in. A full freelancer marketplace, external technician portal, and self-registration for verified contractors are future directions.

## Two Request Paths

### Manual path

1. Customer submits a structured form and optional images.
2. Dispatcher reviews the case, asks for follow-up if necessary, and approves it.
3. Dispatcher assigns a technician.
4. Technician accepts (or rejects) the assignment, starts and executes the job, and submits a verified outcome with hours and parts.
5. The backend calculates the invoice; the customer (or dispatcher on their behalf) confirms it, pays the technician in cash, and the technician uploads a photo of the paid invoice.
6. A dispatcher or manager verifies the photo and confirms payment; the customer may then review the work.

This path is always available. It is the platform's operational baseline and must continue during an AI outage.

### AI-assisted path

1. Customer starts a role-aware chat and provides text and optional images.
2. The Maintenance Intelligence Agent asks relevant follow-up questions, retrieves grounded knowledge where appropriate, and produces a structured case draft.
3. Customer reviews, edits, cancels, or submits that draft.
4. The normal dispatcher workflow applies. The Operations Intelligence Agent can present a backend-computed technician ranking and explain its factors.
5. The technician may use the job-scoped assistant for a case summary, possible causes, required tools, and grounded guidance.
6. A verified technician outcome can be reviewed for promotion into the trusted knowledge base.

AI drafts, recommendations, and possible causes are not diagnoses or authoritative records.

## Case Lifecycle

The NestJS backend alone applies lifecycle transitions:

```text
NEW -> UNDER_REVIEW -> APPROVED -> ASSIGNED -> IN_PROGRESS -> COMPLETED
                    -> REQUIRES_FOLLOW_UP -> UNDER_REVIEW
                    -> REJECTED
ASSIGNED -> APPROVED   (technician rejects the assignment)
NEW, UNDER_REVIEW, REQUIRES_FOLLOW_UP, APPROVED, ASSIGNED -> CANCELLED
```

`COMPLETED`, `CANCELLED`, and `REJECTED` are terminal.

Key transition ownership:

| Transition | Actor | Rule |
| --- | --- | --- |
| Create to `NEW` | Customer | A valid manual submission or confirmed AI draft creates the case |
| `NEW` to `UNDER_REVIEW` | Dispatcher/system | Dispatcher begins review |
| `UNDER_REVIEW` to `REQUIRES_FOLLOW_UP` | Dispatcher | A reason is required; customer can provide clarification |
| `UNDER_REVIEW` to `APPROVED` | Dispatcher | Dispatcher has reviewed the case |
| `UNDER_REVIEW` to `REJECTED` | Dispatcher | A reason is required |
| `REQUIRES_FOLLOW_UP` to `UNDER_REVIEW` | Customer | Customer answers the follow-up |
| `APPROVED` to `ASSIGNED` | Dispatcher | Valid active technician assignment required |
| `ASSIGNED` to `APPROVED` | Assigned technician | Technician rejects the assignment with a reason; the request returns to the pool |
| `ASSIGNED` to `IN_PROGRESS` | Assigned technician | Assignment is `ACCEPTED` (technician accepted); technician starts work |
| `IN_PROGRESS` to `COMPLETED` | Assigned technician | Verified outcome and completion details required |
| `NEW`, `UNDER_REVIEW`, `REQUIRES_FOLLOW_UP`, `APPROVED`, or `ASSIGNED` to `CANCELLED` | Customer | Reason and actor are recorded; a customer cannot cancel `IN_PROGRESS` work |

## Emergency Request Path

Emergency requests have two customer options:

1. **Emergency form:** only when the customer selects `EMERGENCY`, the customer selects already-registered equipment, confirms or changes the pre-filled default address, enters a short description, chooses `FORM` or `HOTLINE` contact preference, and may attach a photo. The backend auto-generates the title, sends the request immediately to the dispatcher queue, and creates an immediate dispatcher notification. This path does not trigger AI analysis. Customers with an unpaid balance can still use this form; the dispatcher notification flags the unpaid balance.
2. **Hotline:** the interface displays the hotline number. This is informational only: it has no backend workflow and creates no maintenance case.

## Core Principles

1. The NestJS modular monolith owns authentication, RBAC, business rules, lifecycle transitions, technician ranking, and all critical decisions.
2. The Python worker is an isolated intelligence service. It has no direct database access and never owns business logic.
3. AI can call only backend-controlled tools. Tools apply the caller's role and resource scope before returning data.
4. The platform works without AI. Manual reporting, review, assignment, execution, and completion are first-class flows.
5. Dispatchers decide assignments. Ranking is deterministic backend logic; AI only presents and explains it.
6. Technician-verified outcomes are the source of truth for completed work. AI output remains advisory.
7. Only curated sources and deliberately promoted verified outcomes enter trusted RAG knowledge. AI output never promotes itself.

## Ranking Rules

The backend produces a normalized, explainable score from eligible technicians.

| Situation | Skill | Experience | Availability | Rate | Customer feedback |
| --- | ---: | ---: | ---: | ---: | ---: |
| Normal | 30% | 15% | 30% | 10% | 15% |
| Emergency | 30% | 15% | 40% | 5% | 10% |

Eligibility checks happen before scoring: approved profile, required skill coverage, not payment-blocked, `is_available`, and any safety restriction. A technician with an accepted or in-progress assignment scores 0 on availability. The rate factor uses the technician's emergency rate for emergency requests and normal rate otherwise; lower is better, and if every candidate charges the same, all score 1.0 on rate. The dispatcher sees the candidate list, individual factors, and the final recommendation but may choose any permitted eligible technician.

NestJS calculates these weights and scores. AI may explain a ranking but never calculates one.

Distance factor is not part of the MVP ranking algorithm. Dispatcher manually considers location when selecting technicians. GPS tracking planned for a future phase.

Future directions include real-time technician GPS location tracking, a dispatcher map view, distance-based ranking, and route optimization for technicians. These require mobile GPS integration and are planned for a future phase.

Payment is business-facing and cash only: the system calculates and displays costs but has no payment gateway. After completion the customer sees the cost breakdown and confirms the invoice (after 7 days without a response, a dispatcher can confirm on their behalf). The customer pays the technician in cash, the technician uploads a photo of the paid invoice, and a dispatcher or manager confirms or disputes payment against that photo. A customer with an unpaid balance, including a disputed payment, cannot submit a normal or urgent request until payment is confirmed. Emergencies are never blocked: they go through and the dispatcher sees the unpaid balance as a flag.

Commission applies only to registered technicians: only when payment is confirmed (not on job completion and not on invoice confirmation), the technician's tier rate is charged on labor cost only (parts excluded) through a ledger, and a manager records payments the technician makes. External technicians have no commission, ledger entry, or review; their labor cost is entered manually by the dispatcher.

## LLM Model Strategy

**Current plan - subject to change during implementation phase.** Both specialized agents use the same Qwen model. The implementation will choose local inference through Ollama or an online Qwen API after hardware, cost, and quality testing. The embedding model is planned as a local pretrained model through Ollama if embeddings are needed; that choice will also be confirmed during implementation.

No fine-tuning is required for the MVP. RAG supplies domain knowledge. Fine-tuning may be considered later only if evaluation shows it materially improves accuracy or domain performance.

## Central AI Chat

All roles use one central chat interface operated by the Orchestrator. For each message, it either answers a simple permitted question directly, routes customer work to the Maintenance Intelligence Agent, or routes dispatcher work to the Operations Intelligence Agent. Managers and technicians talk to the Orchestrator directly: managers get controlled analytics tools, and technicians get job-scoped tools limited to their active assignments. When the speaker is a customer or dispatcher, the Orchestrator hands the conversation to the matching agent. Backend RBAC is checked on every tool call, and there is no third agent.

## Known Planning Risks

- Emergency rule (decided): customer-chosen `priority` (`NORMAL`, `URGENT`, `EMERGENCY`) drives the queue and ranking weights, and a request whose assessed `urgency_level` is `HIGH` or `CRITICAL` is escalated to emergency handling by the backend. AI may only flag it.
- The MVP category list needs stable HVAC and home-appliance definitions so prompts, forms, skills, and RAG ingestion share the same boundary.
- Knowledge promotion is gated by the dispatcher's feedback approval (`approved_for_knowledge`); managers govern sources and can deactivate them. A de-identification rule is still needed before verified case text is indexed.
