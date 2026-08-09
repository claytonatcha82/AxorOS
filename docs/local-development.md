# AxorOS Local Development

## Required baseline

- Windows 10/11, macOS, or Linux
- Git
- Node.js 24 LTS
- npm 11+

## First-time setup

```bash
git clone https://github.com/claytonatcha82/AxorOS.git
cd AxorOS
node scripts/verify-environment.mjs
npm install
npm run typecheck
npm test
npm run build
```

## Development commands

API:

```bash
npm run dev:api
```

Control Center:

```bash
npm run dev:control-center
```

## Environment policy

Local secrets belong in `.env` files that are excluded from Git. Only `.env.example` may be committed. Machine secrets will later be managed through Infisical according to the Phase 6 architecture baseline.

## Verification gate

Step 1.2 is complete only when the environment verifier passes and the repository installs, typechecks, tests, and builds successfully on the founder's development machine.
