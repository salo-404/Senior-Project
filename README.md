# maintAIn

An AI-assisted maintenance management platform for HVAC/air conditioning and home appliances (fridges, washing machines, dishwashers) in indoor spaces. It turns a customer report into a structured case, then supports dispatch, job execution, technician verification, and manager analytics. Humans keep authority over every operational decision, and the platform works without AI.

Senior project. The repository currently holds planning documents only.

## Documents

| Document | Contents |
| --- | --- |
| [plan/00_system_overview.md](plan/00_system_overview.md) | Purpose, roles, request paths, lifecycle, ranking, payment, principles |
| [plan/01_architecture.md](plan/01_architecture.md) | Physical architecture, NestJS modules, Python worker, sync/async boundaries |
| [plan/02_database_schema.md](plan/02_database_schema.md) | Summary of schema decisions |
| [Data_Base_Plan/DB_Schema.md](Data_Base_Plan/DB_Schema.md) | Authoritative schema: tables, enums, constraints, indexes |
| [plan/03_module_plan.md](plan/03_module_plan.md) | Backend modules and endpoints |
| [plan/04_ai_worker_plan.md](plan/04_ai_worker_plan.md) | Orchestrator, agents, tools, queue contract, validation |
| [plan/05_frontend_plan.md](plan/05_frontend_plan.md) | Pages per role, chat interface |
| [plan/06_build_order.md](plan/06_build_order.md) | Build stages, release gates, decision log |
| [plan/07_security_plan.md](plan/07_security_plan.md) | Authentication, RBAC, AI permissions, audit, files |

## Stack

Next.js, NestJS (modular monolith), Prisma, PostgreSQL 16 with pgvector, Redis and BullMQ, a Python AI worker, and Qwen (Ollama or online API; to be decided).
