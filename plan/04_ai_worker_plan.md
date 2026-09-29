# AI Worker Plan

## Responsibility Boundary

The Python worker provides intelligence only. NestJS owns identity, authorization, database writes, lifecycle transitions, assignment, ranking, audit policy, and final validation of domain changes. The worker has no direct database access.

## Worker Components

| Component | Responsibility |
| --- | --- |
| BullMQ handler | Receives versioned jobs, acknowledges only after persisted result/callback outcome |
| Orchestrator | Selects an allowed response path from role, intent, context, and job type |
| Maintenance Intelligence Agent | Customer conversation, evidence analysis, RAG-backed draft construction |
| Operations Intelligence Agent | Dispatcher-facing ranking explanation and permitted operational support |
| Technician assistant | Job-scoped summary, possible causes, tools, and grounded guidance |
| Manager orchestration | Uses controlled analytics tools; no separate agent or RAG corpus |
| RAG service | Retrieval filtering, similarity query through backend tool, context/citation preparation |
| Tool client | Calls only declared NestJS tool endpoints using scoped worker credentials |
<!-- Updated: LLM model strategy -->
| Provider adapters | **Current plan - subject to change during implementation phase.** The same Qwen model serves both agents through Ollama or an online API, selected after hardware, cost, and quality testing; a local pretrained Ollama embedding model is used if needed. No MVP fine-tuning is planned. |
| Validator | Pydantic schema, enum, reference, safety, citation, and policy checks |

## Orchestrator Logic

<!-- Updated: AI architecture clarification -->

The Orchestrator is the single central chat interface for all roles. It answers simple permitted questions directly or routes work to the Maintenance Intelligence Agent or Operations Intelligence Agent. Managers use only the Orchestrator and controlled backend analytics tools; there is no third manager agent. RAG supplies domain knowledge in place of MVP fine-tuning.

1. Load the job contract, user role, conversation scope, permitted capabilities, and case/job context supplied by NestJS.
2. Reject an invalid role/context combination before sending anything to a model. A technician conversation must have an active permitted assignment; a customer conversation must be limited to their records.
3. Classify the requested action into direct response, controlled tool call, or specialized-agent run.
4. Select only capabilities allowed for the role.
5. For safety-sensitive customer questions, request grounded retrieval; if retrieval is unavailable, return a limited, human-review-oriented result instead of a diagnosis.
6. Validate the proposed result. On validation failure, retry once with validation feedback; otherwise return a typed failure for manual workflow.
7. Send the result to NestJS. The backend decides whether it can be stored as a draft, displayed, or discarded.

## Agent 1: Maintenance Intelligence Agent

### Inputs

- Customer message history and current message.
- Authorized attachment references, not unrestricted object-storage paths.
- Customer-supplied equipment context and case draft fields.
<!-- Updated: maintenance categories -->
- Permitted MVP maintenance scope: HVAC/Air Conditioning and home appliances (fridges, washing machines, and dishwashers) in indoor spaces. Plumbing, electrical, and generators are future directions and must not be treated as supported MVP categories.

### Work

1. Identify missing fields: equipment, observed symptoms, timing, location, safety signals, and evidence.
2. Ask one or a small set of high-value follow-up questions rather than collecting an exhaustive interview.
3. Analyze image evidence only through an authorized backend retrieval path.
4. Retrieve relevant approved knowledge chunks filtered by equipment/category/safety metadata.
5. Generate a structured maintenance case draft containing category, symptoms, possible causes, urgency, safety flags, evidence summary, and cited knowledge references where retrieval was used.
6. Clearly mark possible causes as unconfirmed and require customer review before submission.

### Allowed Tools

| Tool | Purpose |
| --- | --- |
| `get_customer_equipment` | Read only the current customer's permitted equipment |
| `get_case_draft_context` | Read current draft fields |
| `get_authorized_attachment` | Obtain time-limited, job-scoped evidence access |
| `search_knowledge` | Retrieve approved chunks and provenance |
| `save_case_draft` | Store validated draft fields only; cannot submit/approve it |

The agent cannot call assignment, status transition, completion, user-management, or arbitrary query tools.

### Prompt Rules

- State role, product scope, safety limits, and the rule that outputs are suggestions.
- Instruct the model not to claim a confirmed diagnosis and not to infer evidence it cannot see.
- Require structured JSON only for draft/result tasks.
- Require source IDs for claims derived from RAG.
- Direct immediate hazards to human/manual escalation flow and mark the safety flag; do not give false reassurance.

## Agent 2: Operations Intelligence Agent

### Inputs and Work

It receives a dispatcher-authorized case summary and the backend's ranking response. It explains candidate eligibility, score factors, weights, trade-offs, and missing data. It may help the dispatcher compare options, but it neither computes scores nor performs assignment.

### Allowed Tools

| Tool | Purpose |
| --- | --- |
| `get_case_for_dispatch` | Read dispatcher-permitted case details |
| `get_technician_ranking` | Read backend-calculated candidates and score factors |
| `get_technician_availability_summary` | Read permitted availability explanation |
| `get_case_history` | Explain review/assignment context |

No separate RAG is used for this agent. It never has write tools for approval, assignment, ranking, or status changes.

## Technician and Manager Paths

- Technician: the worker receives a case/job scope and may use only job summary, approved knowledge retrieval, and authorized case evidence tools. Its answer distinguishes possible causes from technician verification.
- Manager: the orchestrator routes a question to predefined analytics tools. It returns a grounded explanation of the tool data and does not use a third agent or unrestricted database access.

## Queue Contract

### NestJS to Python

```json
{
  "contract_version": "1",
  "ai_run_id": "uuid",
  "job_type": "CUSTOMER_CASE_ANALYSIS",
  "correlation_id": "uuid",
  "actor": { "user_id": "uuid", "role": "CUSTOMER" },
  "conversation_id": "uuid",
  "resource_scope": { "case_id": null, "assignment_id": null },
  "input": { "message": "...", "attachment_ids": ["uuid"] },
  "capabilities": ["search_knowledge", "save_case_draft"],
  "attempt": 1
}
```

Do not put plaintext passwords, database credentials, long-lived JWTs, or unrestricted storage URLs in the job.

### Python to NestJS

```json
{
  "contract_version": "1",
  "ai_run_id": "uuid",
  "status": "SUCCEEDED",
  "result_type": "CASE_DRAFT",
  "result": {
    "summary": "...",
    "category": "HVAC",
    "urgency": "NORMAL",
    "safety_flags": [],
    "possible_causes": ["..."],
    "follow_up_questions": [],
    "knowledge_citations": ["knowledge_chunk_uuid"]
  },
  "tool_call_ids": ["uuid"],
  "model_metadata": { "provider": "ollama", "model": "qwen" },
  "failure": null
}
```

Failure results use `FAILED` or `NEEDS_MANUAL_REVIEW`, a stable failure code, and a user-safe message. They do not return a partially trusted domain mutation.

## Validation and Fallback

1. Validate job shape, role, resource scope, and allowed capability before processing.
2. Validate each tool input server-side in NestJS, including actor permission and record ownership.
3. Validate model JSON against a job-specific Pydantic schema: required keys, enums, array bounds, length limits, no extra action fields.
4. Validate references: cited chunks must have been returned by retrieval; attachment IDs and case IDs must match job scope.
5. Flag safety-sensitive or unsupported results for manual review rather than auto-drafting a confident conclusion.
6. On model failure: retry according to BullMQ policy, try the approved fallback model, then mark the run failed and preserve manual workflow.
7. On RAG failure: retry; for non-safety responses allow a clearly marked response without RAG; for safety/diagnosis-sensitive output require human review.

## AI Risks

- Define the precise worker-to-backend authentication mechanism before implementation; a generic service token without run scope is too broad.
- Model and embedding selection remain an implementation decision. Freeze the embedding model before indexing documents.
- Image-analysis acceptance criteria need evaluation cases before relying on the feature for urgency or safety flags.
