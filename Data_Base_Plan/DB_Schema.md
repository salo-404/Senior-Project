# maintAIn Database Schema

## 1. Overview

| Item | Value |
| --- | --- |
| Total tables | 35 |
| Total domains | 10 |
| Database | PostgreSQL 16 |
| ORM | Prisma |
| Vector extension | pgvector |
| Container image | `pgvector/pgvector:pg16` |
| Maintenance categories | `HVAC`, `HOME_APPLIANCES` |

Future categories: Plumbing, Generators, Water Heaters (added later as new enum values, no table changes).

## 2. Global Rules

### Naming

- Database tables and columns use `snake_case`; table names are plural.
- Prisma models use PascalCase and fields use camelCase, mapped to the database `snake_case` names.
- This document uses database names.

### Enums

Every fixed-value column uses a PostgreSQL enum, never a free `VARCHAR`. Enum values are `UPPER_SNAKE_CASE` and are defined once in [Enums](#3-enums).

### UUIDs and timestamps

- Every primary key is a UUID. Integer auto-increment IDs are prohibited.
- Every timestamp is `TIMESTAMPTZ`.
- Every table has `created_at`.
- Tables that change after creation also have `updated_at`.

### Money and scores

| Value | Type |
| --- | --- |
| Prices, costs, and rates | `DECIMAL(10,2)` |
| `technician_profiles.rating` | `DECIMAL(3,2)`, range 0.00-5.00 |
| AI confidence scores | `DECIMAL(3,2)`, range 0.00-1.00 |
| `assignments.ranking_score` | `DECIMAL(5,2)`, range 0.00-100.00 |

Never use `FLOAT` for money.

### Soft delete and immutable records

- Users, teams, service prices, and knowledge sources are deactivated with `is_active = false`.
- Reviews are hidden with `is_visible = false`.
- Notifications are never deleted; they are marked as read.
- Audit logs are never deleted or modified.

### Relationships and JSONB

- One-to-one relations use a unique foreign key.
- One-to-many relations use a standard foreign key.
- Many-to-many relations require a junction table.
- JSONB is used only for `maintenance_cases` AI/symptom data, `audit_logs.old_value` and `audit_logs.new_value`, `ai_tool_calls.input` and `ai_tool_calls.output`, and `knowledge_chunks.metadata`.

### Schema ownership and authority

Only Prisma in `apps/api` creates and runs migrations.

The Python AI worker is deterministic service code, not the LLM. It never changes the schema. Its database access is limited to:

- **READ:** `knowledge_sources`, `knowledge_documents`, `knowledge_chunks` for retrieval.
- **WRITE:** `knowledge_chunks`, `knowledge_documents.processing_status`, and `knowledge_documents.total_chunks`.

All other results (`maintenance_cases`, `ai_runs`, `ai_tool_calls`) return to NestJS through the job queue, and NestJS writes them.

NestJS controls status transitions, technician ranking, cost calculation, audit-log creation, knowledge-base promotion, and safety escalation. AI may flag a safety concern, but the backend decides escalation.

> The LLM never accesses the database, never generates SQL, and only sees data passed to it by NestJS or the worker. The LLM cannot trigger status transitions, approve/reject/assign work, calculate costs or ranking scores, add knowledge directly, or call unauthorized tools. AI causes are possible findings, never confirmed diagnoses.

## 3. Enums

| Enum | Values |
| --- | --- |
| `role_name` | `CUSTOMER`, `DISPATCHER`, `TECHNICIAN`, `MANAGER` |
| `maintenance_category` | `HVAC`, `HOME_APPLIANCES` |
| `proficiency_level` | `BEGINNER`, `INTERMEDIATE`, `EXPERT` |
| `day_of_week` | `MONDAY`, `TUESDAY`, `WEDNESDAY`, `THURSDAY`, `FRIDAY`, `SATURDAY`, `SUNDAY` |
| `equipment_condition` | `GOOD`, `FAIR`, `POOR` |
| `request_priority` | `NORMAL`, `URGENT`, `EMERGENCY` |
| `request_type` | `MANUAL`, `AI_ASSISTED` |
| `contact_preference` | `FORM`, `HOTLINE` |
| `request_status` | `NEW`, `UNDER_REVIEW`, `REQUIRES_FOLLOW_UP`, `APPROVED`, `ASSIGNED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `REJECTED` |
| `ai_analysis_status` | `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, `SKIPPED` |
| `urgency_level` | `LOW`, `MEDIUM`, `HIGH`, `EMERGENCY` |
| `attachment_file_type` | `IMAGE`, `DOCUMENT` |
| `attachment_purpose` | `CUSTOMER_PHOTO`, `TECHNICIAN_PHOTO`, `JOB_REPORT_PHOTO` |
| `assignment_status` | `PENDING`, `ACCEPTED`, `REJECTED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED` |
| `service_type` | `INSPECTION`, `REPAIR`, `MAINTENANCE`, `INSTALLATION` |
| `ai_prediction_accuracy` | `ACCURATE`, `PARTIAL`, `INACCURATE` |
| `notification_type` | `REQUEST_SUBMITTED`, `REQUEST_APPROVED`, `REQUEST_REJECTED`, `REQUEST_CANCELLED`, `REQUIRES_FOLLOW_UP`, `JOB_ASSIGNED`, `JOB_ACCEPTED`, `JOB_COMPLETED`, `REVIEW_RECEIVED`, `EMERGENCY_ALERT` |
| `notification_priority` | `NORMAL`, `URGENT`, `EMERGENCY` |
| `audit_action` | `CREATE`, `UPDATE`, `DEACTIVATE`, `APPROVE`, `REJECT`, `ASSIGN`, `STATUS_CHANGE`, `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `AI_TOOL_CALL`, `KNOWLEDGE_PROMOTION` |
| `agent_type` | `ORCHESTRATOR`, `MAINTENANCE`, `OPERATIONS` |
| `conversation_status` | `ACTIVE`, `COMPLETED`, `FAILED`, `ABANDONED` |
| `message_role` | `USER`, `ASSISTANT`, `SYSTEM` |
| `ai_run_status` | `SUCCESS`, `FAILED`, `FALLBACK_USED` |
| `tool_call_status` | `SUCCESS`, `FAILED`, `UNAUTHORIZED` |
| `ai_feedback_rating` | `HELPFUL`, `NOT_HELPFUL` |
| `knowledge_source_type` | `VERIFIED_CASE`, `MANUFACTURER_MANUAL`, `TROUBLESHOOTING_GUIDE`, `SAFETY_DOCUMENTATION` |
| `processing_status` | `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED` |
| `job_payment_status` | `PENDING`, `CONFIRMED`, `WAIVED` |
| `payment_method_type` | `CASH`, `TRANSFER`, `OTHER` |

## 4. Domains

Unless marked nullable, every column is `NOT NULL`.

### Domain 1: Users and Roles

Tables: `users`, `roles`, `user_roles`.

#### `users`

```text
id              UUID PK
email           VARCHAR UNIQUE
password_hash   VARCHAR
is_active       BOOLEAN DEFAULT true
last_login_at   TIMESTAMPTZ NULLABLE
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

#### `roles`

```text
id              UUID PK
name            role_name UNIQUE
created_at      TIMESTAMPTZ
```

#### `user_roles`

```text
user_id         UUID FK -> users.id
role_id         UUID FK -> roles.id
assigned_at     TIMESTAMPTZ
PRIMARY KEY (user_id, role_id)
```

Rules: the four roles are seeded once and never changed at runtime. The backend ensures a user has at least one role. A deactivated user cannot log in.

Cross-domain connection: every profile, notification, audit record, and AI record is rooted in a user.

### Domain 2: Profiles

Tables: `customer_profiles`, `customer_addresses`, `technician_profiles`, `staff_profiles`.

#### `customer_profiles`

<!-- Updated: payment model -->
```text
id              UUID PK
user_id         UUID FK -> users.id UNIQUE
first_name      VARCHAR
last_name       VARCHAR
phone           VARCHAR NULLABLE
has_unpaid_balance BOOLEAN DEFAULT false
unpaid_amount   DECIMAL(10,2) DEFAULT 0.00
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

#### `customer_addresses`

```text
id                  UUID PK
customer_profile_id UUID FK -> customer_profiles.id
label               VARCHAR NULLABLE
address_line        VARCHAR
city                VARCHAR
region              VARCHAR NULLABLE
is_default          BOOLEAN DEFAULT false
created_at          TIMESTAMPTZ
updated_at          TIMESTAMPTZ
```

`label` identifies an address such as Home or Office.

#### `technician_profiles`

```text
id               UUID PK
user_id          UUID FK -> users.id UNIQUE
first_name       VARCHAR
last_name        VARCHAR
phone            VARCHAR NULLABLE
bio              TEXT NULLABLE
experience_years INT DEFAULT 0
hourly_rate      DECIMAL(10,2)
rating           DECIMAL(3,2) DEFAULT 0
is_available     BOOLEAN DEFAULT true
created_at       TIMESTAMPTZ
updated_at       TIMESTAMPTZ
```

`is_available` is the technician's manual on/off availability switch, for example during sick leave.

#### `staff_profiles`

```text
id              UUID PK
user_id         UUID FK -> users.id UNIQUE
first_name      VARCHAR
last_name       VARCHAR
phone           VARCHAR NULLABLE
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

`staff_profiles` is shared by dispatchers and managers; `user_roles` determines the role.

Rules: each user has one profile. A customer may have many addresses but only one default address. The backend calculates technician rating from visible reviews. `hourly_rate` feeds the 10% Rate ranking factor and labour-cost calculation.

Cross-domain connection: customers own equipment and requests; technicians own skills, availability, assignments, and job reports.

### Domain 3: Teams and Skills

Tables: `skills`, `technician_skills`, `teams`, `technician_teams`, `technician_availability`.

#### `skills`

```text
id              UUID PK
name            VARCHAR UNIQUE
category        maintenance_category
created_at      TIMESTAMPTZ
```

#### `technician_skills`

```text
id                    UUID PK
technician_profile_id UUID FK -> technician_profiles.id
skill_id              UUID FK -> skills.id
proficiency_level     proficiency_level
years_of_experience   INT DEFAULT 0
created_at            TIMESTAMPTZ
UNIQUE (technician_profile_id, skill_id)
```

#### `teams`

```text
id              UUID PK
name            VARCHAR UNIQUE
category        maintenance_category
description     TEXT NULLABLE
is_active       BOOLEAN DEFAULT true
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

#### `technician_teams`

```text
id                    UUID PK
technician_profile_id UUID FK -> technician_profiles.id
team_id               UUID FK -> teams.id
joined_at             TIMESTAMPTZ
UNIQUE (technician_profile_id, team_id)
```

#### `technician_availability`

```text
id                    UUID PK
technician_profile_id UUID FK -> technician_profiles.id
day_of_week           day_of_week
start_time            TIME
end_time              TIME
is_available          BOOLEAN DEFAULT true
created_at            TIMESTAMPTZ
updated_at            TIMESTAMPTZ
UNIQUE (technician_profile_id, day_of_week)
```

Rules: a technician must have at least one skill and belong to at least one team. There is one availability row per day per technician, and `end_time` must be after `start_time`. Availability is backend-computed from the weekly schedule, `technician_profiles.is_available`, and active assignments in `PENDING`, `ACCEPTED`, or `IN_PROGRESS`. Deactivated teams receive no new assignments.

Cross-domain connection: skills, teams, and availability feed backend technician ranking.

### Domain 4: Equipment

Tables: `equipment_types`, `equipment`.

#### `equipment_types`

```text
id              UUID PK
name            VARCHAR UNIQUE
category        maintenance_category
description     TEXT NULLABLE
created_at      TIMESTAMPTZ
```

<!-- Updated: payment model -->
Examples: Split AC, Central AC, and Ventilation Unit are `HVAC`; Refrigerator, Washing Machine, and Dishwasher are `HOME_APPLIANCES`.

#### `equipment`

```text
id                  UUID PK
customer_profile_id UUID FK -> customer_profiles.id
equipment_type_id   UUID FK -> equipment_types.id
address_id          UUID FK -> customer_addresses.id NULLABLE
brand               VARCHAR NULLABLE
model               VARCHAR NULLABLE
serial_number       VARCHAR NULLABLE
installation_date   DATE NULLABLE
warranty_expiry     DATE NULLABLE
location_notes      TEXT NULLABLE
condition           equipment_condition NULLABLE
created_at          TIMESTAMPTZ
updated_at          TIMESTAMPTZ
```

`location_notes` identifies an installation location such as Master bedroom or Kitchen.

Rules: every maintenance request is linked to equipment. When set, `address_id` must belong to the equipment customer. Brand and model feed RAG retrieval; equipment category determines the handling team; installation date informs possible-cause analysis; warranty is informational only.

Cross-domain connection: equipment is required by maintenance requests and drives category-based dispatch and RAG filtering.

### Domain 5: Maintenance Requests

Tables: `maintenance_requests`, `maintenance_cases`, `request_status_history`, `attachments`.

#### `maintenance_requests`

```text
id                  UUID PK
customer_profile_id UUID FK -> customer_profiles.id
equipment_id        UUID FK -> equipment.id
address_id          UUID FK -> customer_addresses.id
title               VARCHAR
description         TEXT
priority            request_priority
request_type        request_type
contact_preference  contact_preference NULLABLE
status              request_status DEFAULT NEW
ai_analysis_status  ai_analysis_status DEFAULT PENDING
is_safety_escalated BOOLEAN DEFAULT false
escalated_at        TIMESTAMPTZ NULLABLE
escalation_reason   TEXT NULLABLE
rejection_reason    TEXT NULLABLE
cancellation_reason TEXT NULLABLE
created_at          TIMESTAMPTZ
updated_at          TIMESTAMPTZ
```

`contact_preference` is used only for emergency requests. `rejection_reason` is required when status is `REJECTED`.

#### `maintenance_cases`

```text
id                      UUID PK
request_id              UUID FK -> maintenance_requests.id UNIQUE
category                maintenance_category NULLABLE
urgency_level           urgency_level NULLABLE
problem_summary         TEXT NULLABLE
symptoms                TEXT[] NULLABLE
possible_causes         JSONB NULLABLE
safety_concern          BOOLEAN DEFAULT false
safety_flags            JSONB NULLABLE
follow_up_questions     JSONB NULLABLE
recommended_actions     TEXT NULLABLE
ai_confidence_score     DECIMAL(3,2) NULLABLE
rag_sources_used        JSONB NULLABLE
dispatcher_notes        TEXT NULLABLE
is_ai_generated         BOOLEAN DEFAULT false
verified_by_dispatcher  BOOLEAN DEFAULT false
verified_by             UUID FK -> users.id NULLABLE
verified_at             TIMESTAMPTZ NULLABLE
created_at              TIMESTAMPTZ
updated_at              TIMESTAMPTZ
```

JSONB structures:

```text
possible_causes:     [{ cause, confidence (0-1), evidence, source_chunk_ids[] }]
safety_flags:        [{ hazard, severity, note }]
follow_up_questions: [{ question, answer (nullable) }]
rag_sources_used:    [{ chunk_id, document_id, similarity }]
```

#### `request_status_history`

```text
id              UUID PK
request_id      UUID FK -> maintenance_requests.id
old_status      request_status NULLABLE
new_status      request_status
changed_by      UUID FK -> users.id
reason          TEXT NULLABLE
created_at      TIMESTAMPTZ
```

`old_status` is null for the initial `NEW` history entry.

#### `attachments`

```text
id              UUID PK
request_id      UUID FK -> maintenance_requests.id
uploaded_by     UUID FK -> users.id
file_type       attachment_file_type
file_url        VARCHAR
file_size       INT NULLABLE
mime_type       VARCHAR NULLABLE
purpose         attachment_purpose
created_at      TIMESTAMPTZ
```

`file_url` is an object-storage key or URL, never file content. `file_size` is stored in bytes.

#### Allowed status transitions

| From | To | Actor |
| --- | --- | --- |
| None | `NEW` | Customer submits |
| `NEW` | `UNDER_REVIEW` | Dispatcher opens it |
| `UNDER_REVIEW` | `REQUIRES_FOLLOW_UP` | Dispatcher needs information |
| `REQUIRES_FOLLOW_UP` | `UNDER_REVIEW` | Customer answers |
| `UNDER_REVIEW` | `APPROVED` | Dispatcher |
| `UNDER_REVIEW` | `REJECTED` | Dispatcher, with reason |
| `APPROVED` | `ASSIGNED` | Dispatcher assigns |
| `ASSIGNED` | `APPROVED` | Technician rejects assignment; returns to pool |
| `ASSIGNED` | `IN_PROGRESS` | Technician starts |
| `IN_PROGRESS` | `COMPLETED` | Technician submits job report |
| `NEW`, `UNDER_REVIEW`, `REQUIRES_FOLLOW_UP`, `APPROVED`, or `ASSIGNED` | `CANCELLED` | Customer, with reason |

`COMPLETED`, `CANCELLED`, and `REJECTED` are terminal. Customers cannot cancel `IN_PROGRESS` requests.

Rules: a request is the raw customer submission and a case is the structured system-built record. A request has at most one case. Manual requests use `ai_analysis_status = SKIPPED`; AI-assisted requests progress from `PENDING` to `PROCESSING` to `COMPLETED` or `FAILED`. Failed AI work leaves the raw request available to dispatch.

Emergency requests always create a request row for audit, notification, and demo purposes. They set `priority = EMERGENCY`, `is_safety_escalated = true`, `escalated_at`, `escalation_reason`, and `ai_analysis_status = SKIPPED`. Emergency hotline requests create no maintenance case. Every status transition writes `request_status_history`; AI cannot transition status.

Cross-domain connection: requests join customers, equipment, dispatch assignments, notifications, reviews, audits, and AI conversations.

### Domain 6: Assignments and Jobs

Tables: `assignments`, `job_reports`, `job_parts`, `service_prices`, `job_costs`, `technician_case_feedback`.

#### `assignments`

```text
id                    UUID PK
request_id            UUID FK -> maintenance_requests.id
technician_profile_id UUID FK -> technician_profiles.id NULLABLE
assigned_by           UUID FK -> users.id
status                assignment_status DEFAULT PENDING
scheduled_date        DATE
scheduled_time        TIME
ai_recommended        BOOLEAN DEFAULT false
ranking_score         DECIMAL(5,2) NULLABLE
rejection_reason      TEXT NULLABLE
dispatcher_notes      TEXT NULLABLE
is_external           BOOLEAN DEFAULT false
external_name         VARCHAR NULLABLE
external_phone        VARCHAR NULLABLE
created_at            TIMESTAMPTZ
updated_at            TIMESTAMPTZ
```

`ai_recommended` is true when the dispatcher chose the top-ranked technician. `rejection_reason` is used when a technician rejects.

<!-- Updated: technician model -->
Assignment rules: normal jobs use registered company technicians only. For emergency cases, when all available internal technicians are occupied or unavailable, the dispatcher may record an external technician by name and phone only. External technicians have no system profile, cannot log in, and the assignment is for tracking only. When `is_external = false`, `technician_profile_id` is required. When `is_external = true`, `external_name` and `external_phone` are required and `technician_profile_id` must be null.

#### `job_reports`

```text
id                      UUID PK
assignment_id           UUID FK -> assignments.id UNIQUE
actual_cause            TEXT
work_performed          TEXT
job_duration_minutes    INT
technician_notes        TEXT NULLABLE
parts_used              BOOLEAN DEFAULT false
ai_analysis_was_helpful BOOLEAN NULLABLE
completed_at            TIMESTAMPTZ
created_at              TIMESTAMPTZ
updated_at              TIMESTAMPTZ
```

#### `job_parts`

```text
id              UUID PK
job_report_id   UUID FK -> job_reports.id
part_name       VARCHAR
part_number     VARCHAR NULLABLE
quantity        INT
unit_cost       DECIMAL(10,2)
created_at      TIMESTAMPTZ
```

#### `service_prices`

```text
id                UUID PK
equipment_type_id UUID FK -> equipment_types.id
service_type      service_type
base_price        DECIMAL(10,2)
currency          VARCHAR(3) DEFAULT 'USD'
is_active         BOOLEAN DEFAULT true
created_at        TIMESTAMPTZ
updated_at        TIMESTAMPTZ
```

#### `job_costs`

```text
id               UUID PK
job_report_id    UUID FK -> job_reports.id UNIQUE
service_price_id UUID FK -> service_prices.id
base_price       DECIMAL(10,2)
hourly_rate      DECIMAL(10,2)
parts_cost       DECIMAL(10,2) DEFAULT 0
labor_cost       DECIMAL(10,2)
total_cost       DECIMAL(10,2)
currency         VARCHAR(3) DEFAULT 'USD'
notes            TEXT NULLABLE
payment_status   job_payment_status DEFAULT PENDING
payment_method   payment_method_type NULLABLE
payment_confirmed_by UUID FK -> users.id NULLABLE
payment_confirmed_at TIMESTAMPTZ NULLABLE
created_at       TIMESTAMPTZ
```

`service_price_id` identifies the price row applied. Price and rate values are snapshots at calculation time.

Cost calculation is backend-owned:

```text
labor_cost = hourly_rate x (job_duration_minutes / 60)
parts_cost = SUM(unit_cost x quantity)
total_cost = base_price + parts_cost + labor_cost
```

<!-- Updated: payment model -->
Payment is business-facing: there is no payment gateway or real-money transaction inside the app. For internal technicians, `labor_cost = hourly_rate x (job_duration_minutes / 60)`. When the assignment is external, the dispatcher enters `labor_cost` manually because no internal hourly rate exists. After a job is completed, the backend calculates the cost, the customer sees the full breakdown, and `payment_status` starts as `PENDING`. The dispatcher manually confirms payment with `CASH`, `TRANSFER`, or `OTHER`, which sets `payment_status = CONFIRMED`, clears the customer's unpaid balance, and unlocks the customer account. A waived payment uses `WAIVED`.

#### `technician_case_feedback`

```text
id                     UUID PK
job_report_id          UUID FK -> job_reports.id UNIQUE
reviewed_by            UUID FK -> users.id
ai_prediction_accuracy ai_prediction_accuracy
actual_matched_ai      BOOLEAN
approved_for_knowledge BOOLEAN DEFAULT false
feedback_notes         TEXT NULLABLE
created_at             TIMESTAMPTZ
```

`reviewed_by` is the dispatcher. `approved_for_knowledge` is the dispatcher's gate for RAG promotion.

<!-- Updated: technician model -->
Rules: only dispatchers create assignments; AI recommends but never assigns. A request has at most one active assignment in `PENDING`, `ACCEPTED`, or `IN_PROGRESS`. A rejection marks the assignment `REJECTED` and returns the request to `APPROVED`. Ranking scores are saved at assignment time and are not recalculated historically. External assignments do not create reviews, commission charges, or technician-ledger entries. The `reviews.technician_profile_id` remains required; the review step is skipped for external jobs. For external assignments, the dispatcher fills in `job_reports` as a brief summary from a phone call after completion, rather than a technician-submitted structured report. The whole commission, payout, and tier system applies only to registered technicians with a `technician_profile_id`. Each assignment has one job report and each report has one cost record.

<!-- Updated: payment model -->
Payment rules: a customer with `has_unpaid_balance = true` cannot submit any new request, including an emergency request. There is no emergency bypass. When a completed job has a pending amount due, the backend sets `customer_profiles.has_unpaid_balance = true` and `customer_profiles.unpaid_amount` to the outstanding total. The manager dashboard reports outstanding payments, total unpaid amount, and affected customer accounts. When payment is confirmed, `job_costs.payment_status` becomes `CONFIRMED`, `customer_profiles.has_unpaid_balance` becomes `false`, and `customer_profiles.unpaid_amount` becomes `0.00`.

#### Feedback sources

| Location | Actor | Meaning |
| --- | --- | --- |
| `ai_feedback` | Any user | Whether an AI chat response was helpful |
| `job_reports.ai_analysis_was_helpful` | Technician | Whether AI case preparation helped on site |
| `technician_case_feedback` | Dispatcher | Whether the AI cause matched the actual cause; the only knowledge-promotion gate |

Cross-domain connection: assignments use the ranking inputs from Domain 3; completed job reports drive review, cost, audit, and knowledge-promotion workflows.

### Domain 7: Reviews and Feedback

Tables: `reviews`.

#### `reviews`

```text
id                    UUID PK
request_id            UUID FK -> maintenance_requests.id UNIQUE
customer_profile_id   UUID FK -> customer_profiles.id
technician_profile_id UUID FK -> technician_profiles.id
rating                INT
comment               TEXT NULLABLE
is_visible            BOOLEAN DEFAULT true
created_at            TIMESTAMPTZ
updated_at            TIMESTAMPTZ
```

Rules: one review per completed request, submitted only by its customer. The backend recalculates the technician average using visible reviews after a review or visibility change. Managers can hide, but never delete, a review. Technicians cannot see reviewer identity. The rating contributes 5% of ranking feedback.

Cross-domain connection: visible review ratings update `technician_profiles.rating` for future rankings.

### Domain 8: Notifications

Tables: `notifications`.

#### `notifications`

```text
id                  UUID PK
user_id             UUID FK -> users.id
type                notification_type
title               VARCHAR
message             TEXT
is_read             BOOLEAN DEFAULT false
read_at             TIMESTAMPTZ NULLABLE
priority            notification_priority DEFAULT NORMAL
related_request_id  UUID FK -> maintenance_requests.id NULLABLE
created_at          TIMESTAMPTZ
```

Rules: critical status changes trigger notifications. Emergency requests send `EMERGENCY_ALERT` to all dispatchers. Notifications are never deleted and `related_request_id` supports deep linking. The MVP frontend polls every 30 seconds; WebSocket support is future work.

Cross-domain connection: status, assignment, job, review, and emergency workflows can emit notifications.

### Domain 9: Audit and Security

Tables: `audit_logs`.

#### `audit_logs`

```text
id              UUID PK
user_id         UUID FK -> users.id NULLABLE
action          audit_action
entity_type     VARCHAR
entity_id       UUID NULLABLE
old_value       JSONB NULLABLE
new_value       JSONB NULLABLE
ip_address      VARCHAR NULLABLE
user_agent      VARCHAR NULLABLE
created_at      TIMESTAMPTZ
```

`user_id` is null for system or worker actions and failed logins with an unknown user. `entity_type` is an extendable value such as `maintenance_request`, `assignment`, `user`, `maintenance_case`, `review`, `knowledge_document`, or `ai_tool_call`.

Rules: audit logs are database-enforced append-only records and read-only even for managers. Every AI tool call, including unauthorized attempts, has an audit record. `entity_type` and `entity_id` allow records for any entity. `old_value` and `new_value` hold the before/after state. `ai_tool_calls` is the technical trace while `audit_logs` is the accountability record; both record an AI tool call intentionally.

Cross-domain connection: every protected action can create an audit record.

### Domain 10: AI and RAG

Tables: `ai_conversations`, `ai_messages`, `ai_runs`, `ai_tool_calls`, `ai_feedback`, `knowledge_sources`, `knowledge_documents`, `knowledge_chunks`.

#### `ai_conversations`

```text
id              UUID PK
user_id         UUID FK -> users.id
request_id      UUID FK -> maintenance_requests.id NULLABLE
agent_type      agent_type
status          conversation_status DEFAULT ACTIVE
started_at      TIMESTAMPTZ
ended_at        TIMESTAMPTZ NULLABLE
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

`request_id` is null before a chat becomes a submitted request.

#### `ai_messages`

```text
id                  UUID PK
conversation_id     UUID FK -> ai_conversations.id
role                message_role
content             TEXT
agent_type          agent_type NULLABLE
created_at          TIMESTAMPTZ
```

#### `ai_runs`

```text
id                  UUID PK
conversation_id     UUID FK -> ai_conversations.id NULLABLE
request_id          UUID FK -> maintenance_requests.id NULLABLE
agent_type          agent_type
input               TEXT
output              TEXT NULLABLE
model_used          VARCHAR NULLABLE
tokens_used         INT NULLABLE
duration_ms         INT NULLABLE
status              ai_run_status
error_message       TEXT NULLABLE
created_at          TIMESTAMPTZ
```

`conversation_id` is null for background runs, such as queued case analysis. `model_used` records the current Qwen plan, which remains subject to change.

#### `ai_tool_calls`

```text
id              UUID PK
run_id          UUID FK -> ai_runs.id
tool_name       VARCHAR
input           JSONB
output          JSONB NULLABLE
status          tool_call_status
duration_ms     INT NULLABLE
created_at      TIMESTAMPTZ
```

#### `ai_feedback`

```text
id              UUID PK
run_id          UUID FK -> ai_runs.id
user_id         UUID FK -> users.id
rating          ai_feedback_rating
comment         TEXT NULLABLE
created_at      TIMESTAMPTZ
UNIQUE (run_id, user_id)
```

#### `knowledge_sources`

```text
id              UUID PK
name            VARCHAR
category        maintenance_category
source_type     knowledge_source_type
description     TEXT NULLABLE
is_active       BOOLEAN DEFAULT true
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

#### `knowledge_documents`

```text
id                    UUID PK
source_id             UUID FK -> knowledge_sources.id
title                 VARCHAR
file_url              VARCHAR NULLABLE
source_job_report_id  UUID FK -> job_reports.id NULLABLE UNIQUE
verified_by           UUID FK -> users.id NULLABLE
processing_status     processing_status DEFAULT PENDING
total_chunks          INT DEFAULT 0
created_at            TIMESTAMPTZ
updated_at            TIMESTAMPTZ
```

`file_url` is required for uploaded manuals and guides, but null for promoted verified cases. `source_job_report_id` is set only for `VERIFIED_CASE` documents. `verified_by` identifies the dispatcher who approved promotion.

#### `knowledge_chunks`

```text
id              UUID PK
document_id     UUID FK -> knowledge_documents.id
content         TEXT
chunk_index     INT
embedding       VECTOR(N)
metadata        JSONB
created_at      TIMESTAMPTZ
UNIQUE (document_id, chunk_index)
```

`embedding` is a pgvector column. `N` must equal the selected embedding-model output dimension and remains pending; do not set it to `1536`. `metadata` has this structure:

```text
{
  category,
  equipment_type,
  source_type,
  brand,
  model,
  page_number
}
```

Rules for AI tracking: every conversation and message is stored; every agent execution, failure, and fallback has an `ai_runs` row; every backend tool call has an `ai_tool_calls` row; unauthorized calls use `UNAUTHORIZED` and are also audited; model and token usage are recorded per run.

Rules for RAG: `knowledge_chunks` holds pgvector embeddings, and metadata supports category, brand, model, and equipment-type filtering. Trust order is verified case (highest), manufacturer manual (high), safety documentation (high for safety answers), then troubleshooting guide (medium). AI never adds knowledge directly.

Knowledge promotion flow: technician submits a job report, dispatcher completes `technician_case_feedback`, `approved_for_knowledge` is true, backend creates a verified-case `knowledge_documents` row, the Python worker chunks and embeds it, then an audit record uses `KNOWLEDGE_PROMOTION`. The Python worker writes only `knowledge_documents.processing_status`, `knowledge_documents.total_chunks`, and `knowledge_chunks`.

RAG pipeline: document upload or verified-case promotion, text extraction, chunking, embedding, storage in `knowledge_chunks`, cosine-similarity search filtered by metadata, prompt-context injection, and grounded answer with chunk IDs in `rag_sources_used`.

Cross-domain connection: AI tracks user conversations and request analysis; verified job outcomes can become trusted knowledge only through dispatcher approval.

## 5. Database-Level Constraints (Raw SQL Migration)

The following are described only; they will be implemented later in a hand-written SQL migration because Prisma cannot express them.

1. Enable the pgvector extension before any AI and RAG migration.
2. Ensure `reviews.rating` is between 1 and 5.
3. Ensure `technician_availability.end_time` is after `start_time`.
4. Ensure `job_parts.quantity > 0` and all money columns are non-negative.
5. Allow only one active assignment per request with `assignments.status` in `PENDING`, `ACCEPTED`, or `IN_PROGRESS`.
6. Allow only one default address per customer where `customer_addresses.is_default = true`.
7. Allow only one active price per `(equipment_type_id, service_type)` where `service_prices.is_active = true`.
8. Enforce append-only `audit_logs` by rejecting every update or delete.
9. Use an HNSW cosine-distance index with `vector_cosine_ops` for `knowledge_chunks.embedding`, not ivfflat, because the dataset begins nearly empty.

## 6. Required Database Indexes

| Table | Index |
| --- | --- |
| `maintenance_requests` | `customer_profile_id` |
| `maintenance_requests` | `status` |
| `maintenance_requests` | `priority` |
| `maintenance_requests` | `created_at` |
| `maintenance_cases` | `request_id` is already unique |
| `request_status_history` | `request_id` |
| `attachments` | `request_id` |
| `equipment` | `customer_profile_id` |
| `assignments` | `technician_profile_id` |
| `assignments` | `status` |
| `assignments` | `request_id` |
| `ai_messages` | `conversation_id` |
| `ai_runs` | `conversation_id` |
| `ai_runs` | `request_id` |
| `audit_logs` | `user_id` |
| `audit_logs` | composite `(entity_type, entity_id)` |
| `audit_logs` | `created_at` |
| `notifications` | composite `(user_id, is_read)` |
| `knowledge_chunks` | `document_id` |
| `knowledge_chunks` | HNSW vector index with `vector_cosine_ops` |

## 7. Ranking Algorithm Reference

NestJS computes ranking; AI never computes it. Store the result in `assignments.ranking_score` at assignment time.

| Factor | Normal | Emergency | Source columns |
| --- | ---: | ---: | --- |
| Skill | 35% | 30% | `technician_skills` proficiency and category match |
| Experience | 25% | 20% | `technician_profiles.experience_years`, `technician_skills.years_of_experience` |
| Availability | 30% | 40% | `technician_availability`, `technician_profiles.is_available`, active assignment count |
| Rate | 10% | 10% | `technician_profiles.hourly_rate`; lower rate yields higher score |
| Feedback | 5% | 5% | `technician_profiles.rating` |

<!-- Updated: location and distance -->
Distance factor is not part of the MVP ranking algorithm. Dispatcher manually considers location when selecting technicians. GPS tracking planned for a future phase.

Future directions: real-time technician GPS location tracking, a dispatcher map view, distance-based ranking, and route optimization for technicians. These require mobile GPS integration and are planned for a future phase.

## 8. Domain Summary

| Domain | Tables | Notes |
| --- | ---: | --- |
| 1 - Users and Roles | 3 | Foundation; every domain depends on it |
| 2 - Profiles | 4 | Role-specific data extending users |
| 3 - Teams and Skills | 5 | Feeds ranking |
| 4 - Equipment | 2 | Every request links to equipment |
| 5 - Maintenance Requests | 4 | Core workflow |
| 6 - Assignments and Jobs | 6 | Technician execution and verified outcome |
| 7 - Reviews and Feedback | 1 | Feeds ranking |
| 8 - Notifications | 1 | System alerts |
| 9 - Audit and Security | 1 | Accountability layer |
| 10 - AI and RAG | 8 | AI tracking and knowledge base |
| Total | 35 | |

## 9. Open Decisions

- Select the embedding model and vector dimension `N` for `knowledge_chunks`; this blocks only the Domain 10 migration.
- Select Qwen hosting: local Ollama or online API.

## 10. Next Steps

1. Set up Docker, PostgreSQL 16 with pgvector, and Redis in `docker-compose`.
2. Configure Prisma naming conventions.
3. Implement `schema.prisma` domain by domain from 1 through 9, checking a migration after each group.
4. Add the raw SQL migration for the constraints in Section 5.
5. Implement Domain 10 after choosing the embedding model.
6. Add seed data: roles, categories, skills, equipment types, service prices, one demo user per role, technicians with availability, and sample requests.
7. Verify constraints with tests and sample queries.
8. Start backend module implementation.
