# AxorOS

AxorOS is the agency automation system implemented from the approved Phase 6 Architecture Baseline.

## Phase 6 status

Current: **Step 1 — Build Environment and Repository Setup**

This repository intentionally starts with infrastructure and application boundaries before agent logic.

## Repository structure

```text
axoros/
├── apps/
│   ├── control-center/   # Founder/operator web interface
│   └── api/              # AxorOS application/API service
├── packages/
│   └── contracts/        # Shared typed contracts only
├── infra/
│   └── supabase/         # Database migrations/configuration (later steps)
├── docs/
│   └── architecture-decisions/
├── scripts/
└── .github/workflows/
```

## Requirements

- Node.js 24 LTS
- npm 11+
- Git

## Local setup

```bash
nvm use
npm install
npm run dev:api
```

In another terminal:

```bash
npm run dev:control-center
```

API health endpoint: `http://localhost:3001/health`

Control Center: `http://localhost:5173`

## Security rules

- Do not commit secrets.
- `.env.example` contains names only, never credentials.
- Machine secrets will be introduced through Infisical in Phase 6 Step 4.
- Atlas OS is not copied into this repository as an application database.
- Client data must remain isolated by `client_id` and `project_id` once persistence is introduced.
