# maintAIn System Overview

## Purpose

maintAIn is an AI-powered maintenance management platform. It turns a customer report into a structured maintenance case while preserving human authority over all operational decisions. It supports the full workflow from a report through dispatch, job execution, technician verification, and operational insight.

The initial service scope is AC/HVAC, refrigerators, and selected electrical problems. Plumbing is out of scope.

## Roles

| Role | Primary responsibility | Authority |
| --- | --- | --- |
| Customer | Report a problem, provide evidence, review a generated draft, track progress, review completed work | Creates and edits their own request before submission |
| Dispatcher | Review cases, request clarification, approve/reject, assign technicians, manage exceptions | Final authority for approval and assignment |
| Technician | Accept assigned work, execute it, report findings and outcome | Verified job outcome is the authoritative service record |
| Manager | Monitor operations and ask approved analytics questions | Reviews metrics and verified operational data |

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
| Normal | 35% | 25% | 25% | 10% | 5% |
| Emergency | 30% | 20% | 35% | 10% | 5% |

Eligibility checks happen before scoring: active status, required skill coverage, availability, and any safety restriction. The dispatcher sees the candidate list, individual factors, and the final recommendation but may choose any permitted eligible technician.

## Known Planning Risks

- Define a single urgency vocabulary and the exact condition that makes a request an emergency before ranking is implemented.
- Define cancellation rights by state, including whether a customer can cancel after assignment.
- "Selected electrical problems" needs an approved category list so prompts, forms, skills, and RAG ingestion share the same boundary.
- Knowledge promotion needs a manager/dispatcher approval policy and a de-identification rule before verified case text is indexed.
