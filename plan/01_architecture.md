# Architecture Plan

## Physical Architecture

```text
Next.js web application
        |
        v
NestJS modular monolith <----> PostgreSQL with pgvector
        |  |                         |
        |  +------------------------> Object storage (image metadata/access)
        |
        +--------------------------> Redis and BullMQ
                                        |
                                        v
                                  Python AI Worker
                                   |             |
                                   v             v
                              Qwen via Ollama   Embedding model via Ollama
```

The web application communicates only with NestJS. The Python worker receives a serialized job through BullMQ and returns a validated result to a backend-owned completion path. The worker has no PostgreSQL credentials and no object-storage credential that bypasses NestJS authorization.

## Technology Responsibilities

| Technology | Responsibility |
| --- | --- |
| Next.js, React, Tailwind CSS | Role-specific user interface, API client, client-side form state |
| NestJS, TypeScript | REST API, authentication, RBAC, domain rules, state machine, ranking, audit records, queue producer/consumer coordination |
| Prisma | Schema, migrations, transactional persistence |
| PostgreSQL + pgvector | Transactional data, audit data, conversation metadata, knowledge chunks and embeddings |
| Redis + BullMQ | Durable asynchronous AI job queue, retry state, delayed jobs |
| Python AI Worker | Qwen calls, image analysis, retrieval orchestration, structured output validation before callback/result storage |
| Ollama with Qwen and embedding model | Local LLM and embedding inference; an approved online Qwen API can replace the inference endpoint later without changing domain contracts |
| Object storage | Original customer images and approved document assets, accessed through backend-issued authorized operations |

## NestJS Modules

| Module | Main responsibility |
| --- | --- |
| `auth` | Login, JWT issuance/refresh, password handling, session revocation |
| `identity` | Users, role assignments, customer/dispatcher/technician profiles |
| `audit` | Immutable records for critical actions and AI tool calls |
| `files` | Attachment metadata, authorized upload/download access, image ownership checks |
| `equipment` | Customer equipment and equipment types |
| `cases` | Requests, maintenance cases, evidence, lifecycle and history |
| `dispatch` | Dispatcher review, technician assignments, ranking and availability checks |
| `jobs` | Technician acceptance, work execution, job reports, costs/parts when enabled |
| `reviews` | Customer feedback following completed work |
| `notifications` | In-app notification records and delivery coordination |
| `ai-gateway` | Conversations, role routing, controlled tools, run records, queue contracts, result application |
| `knowledge` | Curated sources, document ingestion coordination, chunks, verified-case promotion |
| `analytics` | Manager-scoped operational queries and aggregate read models |

No module reads another module's Prisma models as a shortcut around that module's service. Cross-domain writes use the owning service within a transaction where needed.

## Python Worker Structure

```text
worker/
  app/
    main.py                 # Worker startup and BullMQ handlers
    contracts/              # Pydantic job/result schemas shared by contract version
    orchestrator/           # Role and intent routing
    agents/
      maintenance.py        # Customer-side agent
      operations.py         # Dispatcher-side agent
      technician.py         # Job-scoped assistant behavior
      manager.py            # Orchestrator tool-based manager responses
    rag/                    # Retrieval, context construction, citations
    providers/              # Qwen/Ollama and embedding client adapters
    tools/                  # Backend API tool client; no database client
    validation/             # JSON schema and safety/result checks
    observability/          # Correlation IDs, structured logs, run timing
```

The worker treats every job payload as untrusted input, uses a correlation ID, and returns a typed result with a contract version. It must not invent state transitions, assignments, or verified outcomes.

## Synchronous and Asynchronous Boundaries

| Synchronous NestJS request | Asynchronous BullMQ job |
| --- | --- |
| Login, profile changes, list/detail reads | Customer text analysis |
| Create/update a manual request | Image analysis |
| Dispatcher review, approval, assignment | Follow-up question generation |
| Technician accept/start/complete actions | RAG analysis and structured case draft generation |
| Reviews, availability updates, ranking read | Technician job brief generation |
| Manager analytics tool query authorization | Knowledge document extraction/chunking/embedding |

The API returns an `ai_run_id` and a pending status for async work. Clients poll a run endpoint or receive a notification; they never wait for a model call in the HTTP request.

## Communication Flows

### Manual case

```text
Web -> NestJS cases -> PostgreSQL
Web <- case + status ----- NestJS
```

### AI-assisted draft

```text
Web -> NestJS ai-gateway -> PostgreSQL (ai_run pending)
                         -> BullMQ -> Python worker
Python worker -> controlled NestJS tool API (scoped JWT/service assertion)
Python worker -> BullMQ result/callback -> NestJS ai-gateway
NestJS -> PostgreSQL (validated draft/result) -> Web
```

### Assignment

```text
Dispatcher web -> NestJS dispatch -> eligibility + ranking -> PostgreSQL
Dispatcher confirms assignment -> cases/dispatch transaction -> notification record
```

## Architecture Risks

- Do not let BullMQ payloads include long-lived user JWTs. Use short-lived, single-run worker credentials or a backend callback authenticated to the run.
- Image processing needs a defined backend-authorized retrieval mechanism for the worker; raw public storage URLs would violate the access model.
- Keep initial RAG ingestion narrow. Start with a small curated document set and explicit provenance fields before promoting historical cases.
