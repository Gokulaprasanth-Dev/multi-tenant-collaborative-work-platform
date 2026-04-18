# CLAUDE.md — [Project Name]

> Inherits global rules from ~/.claude/CLAUDE.md. This file adds project-specific context only.
> Created: [YYYY-MM-DD]

---

## Stack
- Language: [e.g. TypeScript / Node.js 20]
- Framework: [e.g. Express / Next.js / Angular]
- DB: [e.g. PostgreSQL via raw SQL / Prisma]
- Cache: [e.g. Redis]
- Test runner: [e.g. Jest / Vitest / Karma]
- Queue: [e.g. BullMQ]

## Run Commands
```bash
npm run dev          # start dev server (port XXXX)
npm run test:unit    # unit tests — no DB/Redis needed
npm run test:integration  # needs TEST_DATABASE_URL + REDIS_URL
npm run build        # production build
npm run lint         # lint + typecheck
```

## Key Files
- Entry point: `src/`
- Routes: `src/routes/` or `src/modules/*/router.ts`
- Config: `src/shared/config.ts`
- Tests: `tests/`
- Migrations: `migrations/`

## Forbidden
- Never edit: [file] without [precondition]
- Never rewrite: [file] — [reason]
- Never commit: `.env` files

## Conventions
- Error handling: [e.g. always use AppError from src/shared/errors/]
- Logging: [e.g. use logger from src/shared/logger.ts, never console.log]
- API responses: [e.g. always use res.success() / res.created()]
- DB queries: [e.g. always use queryPrimary/queryReplica — never pool directly]

## Test Patterns
```bash
# Run single test file
npm run test:unit -- --testPathPattern="filename"

# Run with coverage
npm run test:unit -- --coverage
```

---

> **Session continuity rules** live in `~/.claude/CLAUDE.md §6` — not repeated here.
> On every session start: read `SESSION.md` → read `TASK.md` → state resumption point → begin.

---

## Brainstorming

- Never brainstorm without a concrete decision stated upfront
- Cap at 8 turns — if no decision, output SPEC.md and stop
- Never present more than 3 options — recommend one and defend it
- Every brainstorm session MUST end with a SPEC.md in the project root
- No SPEC.md = session failed — do not proceed to implementation

---

## Delegation

- All file reading, grep work, and research: delegate to sub-agents
- Main agent receives summaries only — never raw file contents
- If exploring more than 1 directory or 3 files: delegate, don't wander
- Sub-agent budget: up to 10 tool calls per delegation task
- State exploration goal before delegating — ask clarifying questions first
