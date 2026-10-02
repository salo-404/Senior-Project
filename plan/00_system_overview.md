# maintAIn System Overview

## Purpose

maintAIn is an AI-powered maintenance management platform. It turns a customer report into a structured maintenance case while preserving human authority over all operational decisions. It supports the full workflow from a report through dispatch, job execution, technician verification, and operational insight.

<!-- Updated: maintenance categories -->
The MVP service scope is HVAC/Air Conditioning and home appliances: fridges, washing machines, and dishwashers. The focus is indoor spaces: homes, offices, universities, and schools. Plumbing, electrical, and generators are future directions only and are not part of the MVP.

## Roles

| Role | Primary responsibility | Authority |
| --- | --- | --- |
| Customer | Report a problem, provide evidence, review a generated draft, track progress, review completed work | Creates and edits their own request before submission |
| Dispatcher | Review cases, request clarification, approve/reject, assign technicians, manage exceptions | Final authority for approval and assignment |
| Technician | Accept assigned work, execute it, report findings and outcome | Verified job outcome is the authoritative service record |
| Manager | Monitor operations and ask approved analytics questions | Reviews metrics and verified operational data |

<!-- Updated: technician model -->
Technician model: the primary model is company-contracted technicians registered in the system with full profiles, skills, teams, and availability. For super urgent emergency cases only, when all internal technicians are occupied or unavailable, the dispatcher may record an external technician by name and phone only. External engagement is a closed, one-off transaction handled directly by the dispatcher; the external technician has no system profile and cannot log in. A full freelancer marketplace, external technician portal, and self-registration for verified contractors are future directions.

## Two Request Paths

### Manual path

1. Customer submits a structured form and optional images.
2. Dispatcher reviews the case, asks for follow-up if necessary, and approves it.
3. Dispatcher assigns a technician.
4. Technician accepts, executes the job, and submits a verified outcome.
5. The case is completed and the customer may submit a review.

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
                    -> CANCELLED
```

Key transition ownership:

| Transition | Actor | Rule |
| --- | --- | --- |
| Create to `NEW` | Customer | A valid manual submission or confirmed AI draft creates the case |
| `NEW` to `UNDER_REVIEW` | Dispatcher/system | Dispatcher begins review |
| `UNDER_REVIEW` to `REQUIRES_FOLLOW_UP` | Dispatcher | A reason is required; customer can provide clarification |
| `UNDER_REVIEW` to `APPROVED` | Dispatcher | Dispatcher has reviewed the case |
| `APPROVED` to `ASSIGNED` | Dispatcher | Valid active technician assignment required |
| `ASSIGNED` to `IN_PROGRESS` | Assigned technician | Technician accepts the current assignment |
| `IN_PROGRESS` to `COMPLETED` | Assigned technician | Verified outcome and completion details required |
| Eligible pre-completion state to `CANCELLED` | Customer or dispatcher per policy | Cancellation reason and actor are recorded |

## Emergency Request Path

<!-- Updated: emergency request path -->

Emergency requests have two customer options:

<!-- Updated: emergency intake form -->
1. **Emergency form:** only when the customer selects `EMERGENCY`, the customer selects already-registered equipment, confirms or changes the pre-filled default address, enters a short description, chooses `FORM` or `HOTLINE` contact preference, and may attach a photo. The backend auto-generates the title, sends the request immediately to the dispatcher queue, and creates an immediate dispatcher notification. This path does not trigger AI analysis. Customers with an unpaid balance cannot use this form.
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

<!-- Updated: technician ranking -->

The backend produces a normalized, explainable score from eligible technicians.

| Situation | Skill | Experience | Availability | Rate | Customer feedback |
| --- | ---: | ---: | ---: | ---: | ---: |
| Normal | 35% | 25% | 30% | 10% | 5% |
| Emergency | 30% | 20% | 40% | 10% | 5% |

Eligibility checks happen before scoring: active status, required skill coverage, availability, and any safety restriction. The dispatcher sees the candidate list, individual factors, and the final recommendation but may choose any permitted eligible technician.

NestJS calculates these weights and scores. AI may explain a ranking but never calculates one.

<!-- Updated: location and distance -->
Distance factor is not part of the MVP ranking algorithm. Dispatcher manually considers location when selecting technicians. GPS tracking planned for a future phase.

Future directions include real-time technician GPS location tracking, a dispatcher map view, distance-based ranking, and route optimization for technicians. These require mobile GPS integration and are planned for a future phase.

<!-- Updated: payment model -->
Payment is business-facing: the system calculates and displays costs, but has no payment gateway or real-money transaction. After completion, the customer sees the full cost breakdown and payment remains pending until the dispatcher confirms it manually. A customer with an unpaid balance cannot submit any new request, including emergencies, until the account is unlocked after confirmation.

## LLM Model Strategy

<!-- Updated: LLM model strategy -->

**Current plan - subject to change during implementation phase.** Both specialized agents use the same Qwen model. The implementation will choose local inference through Ollama or an online Qwen API after hardware, cost, and quality testing. The embedding model is planned as a local pretrained model through Ollama if embeddings are needed; that choice will also be confirmed during implementation.

No fine-tuning is required for the MVP. RAG supplies domain knowledge. Fine-tuning may be considered later only if evaluation shows it materially improves accuracy or domain performance.

## Central AI Chat

<!-- Updated: AI architecture clarification -->

All roles use one central chat interface operated by the Orchestrator. For each message, it either answers a simple permitted question directly, routes customer work to the Maintenance Intelligence Agent, or routes dispatcher work to the Operations Intelligence Agent. Managers use the Orchestrator with controlled backend analytics tools only; there is no third agent.

## Known Planning Risks

- Define a single urgency vocabulary and the exact condition that makes a request an emergency before ranking is implemented.
- Define cancellation rights by state, including whether a customer can cancel after assignment.
- The MVP category list needs stable HVAC and home-appliance definitions so prompts, forms, skills, and RAG ingestion share the same boundary.
- Knowledge promotion needs a manager/dispatcher approval policy and a de-identification rule before verified case text is indexed.
