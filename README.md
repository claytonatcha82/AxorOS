# AxorOS

AxorOS is the governed AI operating system for AxorOS Digital. It coordinates specialist AI agents, deterministic workflows, persistent operational state, approved external integrations, and Atlas OS knowledge to support a controlled digital-agency lifecycle from lead research through sales, payment, production, deployment, support, marketing, finance, and executive oversight.

The system is designed around one core principle:

> AI reasoning is not operational authority.

Models may research, classify, draft, recommend, and assist. High-risk external actions are controlled by explicit capabilities, persisted evidence, deterministic policy, approval gates, integration risk boundaries, and a global pilot state.

## Current status

**Baseline date:** 30 August 2026  
**Stage:** Controlled pilot activation readiness  
**Pilot state:** `PILOT_DISABLED`

The core AxorOS architecture is implemented. The repository contains agent runtimes, PostgreSQL persistence, Atlas knowledge ingestion and retrieval, governed handoffs, recovery and idempotency controls, external-provider integrations, synthetic and persisted lifecycle verifiers, and evidence-backed pilot activation controls.

Current activation position:

- Google Workspace / Gmail supervised Sales sending: live-provider verified.
- AxorOS professional email identities: configured in development and production.
- SPF, DKIM, and DMARC: configured and verified.
- Atlas Mirror knowledge architecture: implemented with versioned ingestion, provenance, security classification, and agent-aware retrieval.
- Lead, Sales, Finance, Operations, and Production lifecycle paths: implemented and covered by persisted/synthetic verification.
- Cloudflare deployment integrations and deployment safety boundary: implemented.
- Paystack integration: implemented; production activation requires the approved live credential and final live-readiness verification.
- Marketing autonomous publishing: intentionally disabled for the pilot.
- Non-Sales Gmail live sending: intentionally restricted by governance.
- Pilot activation remains fail-closed until the evidence-backed Human Executive activation process is completed.

The first real pilot is intended to validate the complete external-provider lifecycle under controlled volume. It is not evidence of unrestricted production autonomy.

## Core agents

AxorOS defines nine core agents:

| Agent | Primary responsibility |
| --- | --- |
| Knowledge Agent | Knowledge access, retrieval support, and governed Atlas context |
| Executive Agent | Executive oversight, objectives, governance, and escalation |
| Operations Agent | Workflow orchestration, readiness, dependencies, capacity, and coordination |
| Lead Agent | Business discovery, public research, qualification, and Sales handoff |
| Sales Agent | Opportunity intake, outreach, supervised email, replies, and sales progression |
| Production Agent | Planning, technical implementation, preview, deployment, and handover |
| Support Agent | Support workflows, incidents, client health, and post-delivery coordination |
| Marketing Agent | Brand, campaigns, content, analytics, SEO, and inbound-demand assistance |
| Finance Agent | Payment requirements, payment state, clearance, ledger, reconciliation, and reporting |

Agents are registered against explicit capabilities. Model output alone does not grant an agent permission to execute an external action.

## End-to-end agency lifecycle

The governed pilot architecture follows this broad flow:

```text
Atlas OS
   |
   v
Private Atlas Mirror
   |
   v
Versioned knowledge ingestion
   |
   v
PostgreSQL knowledge index
   |
   +-----------------------------+
                                 |
                                 v
Lead Agent
   |
   +--> public business research
   +--> Atlas ICP / qualification context
   +--> persisted qualification evidence
   |
   v
Qualified Lead -> Sales handoff
   |
   v
Sales Agent
   |
   +--> opportunity assessment
   +--> Atlas sales context
   +--> outreach draft
   +--> Human Executive review / send gate
   +--> supervised Gmail execution
   +--> reply evidence / classification
   |
   v
Commercial progression
   |
   v
Finance Agent
   |
   +--> commercial payment requirement
   +--> Paystack payment request
   +--> webhook evidence
   +--> independent payment verification
   +--> Finance clearance
   +--> immutable ledger / reconciliation
   |
   v
Operations Agent
   |
   +--> prerequisites
   +--> readiness
   +--> dependency coordination
   |
   v
Production Agent
   |
   +--> Atlas development context
   +--> project planning
   +--> implementation
   +--> preview
   +--> governed production deployment
   |
   v
Delivery / Support / Marketing / Finance follow-through
```

Transitions between stages are governed by contracts and persisted state rather than informal model-to-model delegation.

## Atlas OS knowledge architecture

Atlas OS remains the agency source of truth. It is not copied into the AxorOS source repository as an application database.

The knowledge path is:

```text
Atlas OS
  -> private Atlas mirror
  -> controlled ingestion workflow
  -> document parsing and structure-aware chunking
  -> PostgreSQL knowledge storage
  -> agent-aware retrieval
  -> bounded context package
  -> agent/model execution
```

### Ingestion

Atlas ingestion supports incremental source acquisition. Documents are checksum-tracked and can be classified as added, changed, unchanged, or missing from source.

The ingestion process records source/version information so retrieved knowledge can be traced to an Atlas release or source commit.

Atlas ingestion is intentionally controlled during the pilot rather than automatically promoting every knowledge change into active agent context.

### Retrieval

Knowledge retrieval is bounded by agent, task, security classification, result count, and context size.

Retrieved material carries provenance such as:

- source path;
- source version;
- document checksum;
- chunk checksum;
- security classification;
- authority metadata;
- heading path; and
- chunk identifier.

Specialist knowledge adapters exist for the operational agents. Critical workflows can require specific authoritative Atlas sources rather than silently substituting loosely related material.

If required authoritative context is unavailable, affected workflows are designed to fail rather than invent policy.

## Governance and safety model

AxorOS uses layered authority controls.

### Agent capability boundaries

Agents operate through registered capabilities. A capability determines what a runtime may attempt; it does not automatically authorize high-risk provider execution.

### Integration policy

External integrations are registered centrally and governed by execution mode, operation, and risk ceiling. The default posture is sandbox/fail-closed. Live operations must be explicitly enabled by scoped policy.

### Human authority

Human approval is persisted where required. For example, supervised Sales email requires an approved Human Executive send gate. Email approval does not grant pricing or commercial-commitment authority.

### Pilot kill switch

The global pilot state provides an additional authority boundary. `PILOT_DISABLED` prevents protected live operations even when lower-level workflow prerequisites have been satisfied.

### Evidence-backed activation

Pilot activation requires persisted PASS evidence across required verification categories, including:

- synthetic lifecycle;
- persisted runtime;
- Finance integrity;
- control-plane safety; and
- deployment safety.

Readiness can be derived only from the required evidence. Activation remains a Human Executive action.

## Lead and Sales workflow

Lead processing combines external research with Atlas policy.

The Lead runtime can use Google Places and Tavily for public research, select relevant official business information, retrieve Atlas qualification context, persist qualification evidence, and produce a governed Sales handoff.

A Lead-to-Sales handoff does not itself authorize outreach.

Sales then performs persisted intake and opportunity processing. Its supervised outbound-email path includes draft creation, review, explicit send authority, idempotent execution, send-attempt persistence, reply evidence, classification, opt-out handling, delivery-failure handling, suppression, and next-action resolution.

The live Gmail path is intentionally limited to supervised Sales sending during the pilot.

## Finance and payments

Finance is treated as a high-risk domain.

The Finance architecture includes:

- commercial payment requirements;
- Paystack payment requests;
- signed webhook ingress;
- persisted payment evidence;
- independent payment verification;
- current payment state;
- Finance clearance;
- commercial-payment binding;
- payment-requirement satisfaction;
- immutable ledger recording;
- reconciliation;
- reporting;
- profitability and subscription support; and
- Finance alerts.

A provider event alone does not grant Production authority. Finance state, commercial requirements, Operations readiness, and Production prerequisites remain separate governed concerns.

Production Paystack activation requires an `sk_live_` credential and successful live-readiness verification before the pilot may rely on the live provider.

## Operations and Production

Operations coordinates dependencies and determines whether downstream Production prerequisites are satisfied.

Production contains persisted planning and execution paths for technical work, project provisioning, preview deployment, production deployment, rollback, and handover.

Cloudflare provider capabilities are separated by operation, including project provisioning, preview deployment, production deployment, and rollback. Production deployment and rollback are treated as high-risk/critical operations and remain subject to authority controls and the global pilot state.

## Persistence, idempotency, and recovery

PostgreSQL is the operational state backbone.

AxorOS persists workflow state, evidence, handoffs, approvals, payment records, Finance ledger data, readiness records, execution attempts, and other operational artifacts rather than relying on transient model context.

Idempotency controls are used where repeated execution could create duplicate external effects. Runtime recovery and dependency-retry infrastructure supports controlled recovery after process restarts, network interruptions, and provider failures.

The intended failure posture is fail-closed: unavailable evidence or dependencies should stop governed progression rather than cause an agent to improvise authority.

## External integrations

Depending on environment configuration, AxorOS supports integrations for:

- Google Workspace / Gmail;
- Google Places;
- Tavily public-web research;
- Paystack;
- Cloudflare;
- Gemini;
- OpenAI;
- Anthropic; and
- PostgreSQL-backed persistence.

Secrets are injected at runtime through Infisical and must never be committed to the repository.

## Google Workspace identities

The configured professional identities are:

- `sales@axorosdigital.com` — AxorOS Sales Team
- `finance@axorosdigital.com` — AxorOS Finance Team
- `marketing@axorosdigital.com` — AxorOS Marketing Team
- `operations@axorosdigital.com` — AxorOS Operations Team
- `support@axorosdigital.com` — AxorOS Support Team

During the pilot, configuration of an identity does not imply unrestricted send authority. Live Gmail execution remains governed by agent and integration policy.

## Repository structure

```text
AxorOS/
├── apps/
│   ├── api/                    # API, agents, runtimes, persistence, integrations
│   └── control-center/         # Founder/operator control interface
├── packages/
│   └── contracts/              # Shared typed contracts
├── infra/
│   └── supabase/               # PostgreSQL/Supabase migrations and infrastructure
├── docs/
│   └── architecture-decisions/ # Architecture decision records
├── scripts/                    # Verification, migration, ingestion, and operational scripts
└── .github/
    └── workflows/              # CI and controlled Atlas ingestion workflows
```

The API application contains the operational implementation for agents, knowledge, integrations, data stores, workflows, control-plane handlers, governance, recovery, and pilot activation.

## Requirements

Development baseline:

- Node.js 24 LTS
- npm 11+
- Git
- PostgreSQL/Supabase environment
- Infisical CLI for runtime secret injection where required

External-provider credentials are required only for the integrations being exercised.

## Local setup

Install dependencies:

```bash
npm install
```

Start the API:

```bash
npm run dev:api
```

Start the Control Center in another terminal:

```bash
npm run dev:control-center
```

Default local endpoints:

- API health: `http://localhost:3001/health`
- API readiness: `http://localhost:3001/ready`
- Control Center: `http://localhost:5173`

## Standard validation

Before merging operational changes, run:

```bash
npm run typecheck
npm test
npm run build
```

Provider/database verification scripts under `scripts/` exercise additional persisted and live boundaries. They must be run with the appropriate Infisical environment and should not be replaced by unit tests when validating pilot readiness.

## Verification framework

AxorOS contains targeted verifiers for areas including:

- Atlas ingestion, retrieval, and context;
- Lead research and qualification;
- Lead-to-Sales lifecycle;
- supervised Sales Gmail;
- Sales inbound replies and suppression;
- Finance payment and clearance state;
- Paystack webhooks and payment requests;
- Finance ledger integrity and reconciliation;
- Operations readiness;
- persisted Production runtime;
- Cloudflare provisioning and deployment boundaries;
- runtime recovery;
- control-plane authentication;
- pilot state transitions; and
- consolidated synthetic lifecycle behaviour.

The pilot-readiness evidence suite persists PASS receipts only after its underlying verifier exits successfully. The suite is not itself authorized to activate the pilot.

## Security rules

- Never commit credentials, API keys, OAuth tokens, refresh tokens, database passwords, or provider secrets.
- Use Infisical for machine-secret injection.
- Keep development and production secrets/environment state separated.
- Production Paystack configuration must use a live credential; non-production must not silently accept one as a test credential.
- Atlas OS remains outside the application repository and is accessed through the controlled knowledge pipeline.
- Knowledge access must respect agent/task/security boundaries.
- Client/project persistence must preserve tenant and project isolation.
- High-risk external actions require the appropriate persisted authority.
- Human approval must be attributable to the authorized Human Executive where required.
- Do not bypass idempotency, suppression, payment verification, deployment gates, or the pilot kill switch to make a test pass.
- Do not activate the pilot merely because unit tests are green.

## Pilot activation boundary

Before activating the controlled pilot, the intended final sequence is:

1. obtain and inject the approved Paystack production credential;
2. validate production secrets and environment consistency;
3. run Paystack live-readiness verification without moving money;
4. synchronize the approved Atlas mirror state;
5. run controlled Atlas ingestion;
6. verify knowledge retrieval and context against the intended pilot database;
7. run the full evidence-backed pilot-readiness verification suite;
8. confirm the system remains `PILOT_DISABLED`;
9. review persisted readiness evidence;
10. execute the Human Executive activation process; and
11. begin with a low-volume controlled lifecycle before increasing throughput.

The pilot exists to prove the complete real-world provider chain. Synthetic and persisted verification reduce risk but do not replace the first controlled live lifecycle.

## Operating principle

AxorOS is designed to automate agency execution without transferring unrestricted business authority to language models.

The desired relationship is:

```text
AI reasoning
     +
Atlas knowledge
     +
deterministic workflow
     +
persistent evidence
     +
explicit authority
     +
bounded integrations
     =
governed automation
```

That principle should be preserved as AxorOS moves from pilot operation toward broader autonomy.
