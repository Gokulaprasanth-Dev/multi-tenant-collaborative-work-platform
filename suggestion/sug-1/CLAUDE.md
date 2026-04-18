# CLAUDE.md

Behavioral rules for Claude Code. Bias toward caution over speed — for trivial tasks, use judgment.

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- State assumptions explicitly before acting. If uncertain, ask — don't guess and run.
- If multiple interpretations exist, present them. Never pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask once, then proceed.
- Write a one-line plan before any non-trivial code change.

---

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No flexibility or configurability that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and 50 would do, rewrite it.

**Test:** Would a senior engineer say this is overcomplicated? If yes, simplify.

---

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

- Never "improve" adjacent code, comments, or formatting as a side effect.
- Never refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- Remove only imports/variables/functions that YOUR changes made unused.
- Prefer `Edit` over `Write` for any existing file.
- Never use `Write` on a file you didn't create in this session.

**Test:** Every changed line must trace directly to the user's request.

---

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Fix the bug" → write a test that reproduces it, then make it pass
- "Add validation" → write tests for invalid inputs, then make them pass
- "Refactor X" → ensure tests pass before and after

For multi-step tasks, state a plan first:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
```

Never declare success on compile-clean alone — verify runtime behavior.

---

## 5. Debugging Protocol

**Diagnose before acting. Never guess-and-check.**

Before touching any code:
1. State the hypothesis — what you believe is wrong and why
2. Identify the minimal reproduction path
3. Confirm root cause with evidence (quote relevant log lines, stack traces)
4. Only then write the fix

- Never make multiple simultaneous changes to test a hypothesis
- If three hypotheses fail, stop and ask the user to narrow scope
- After fixing, verify the original symptom is gone — not just that it compiles

---

## 6. Session Continuity

**Token limits kill sessions without warning. SESSION.md is the only state that survives.**

### Every 5 turns — no exceptions:
Update `SESSION.md` with:
1. **Last Updated** — timestamp + turn count
2. **Active Task** — one sentence, exact file and line range if mid-edit
3. **Resumption Point** — next action specific enough for cold-start Claude to act without reading other files
4. **Broken / Unstable** — anything currently broken, even if unrelated to current task
5. **Last Decision Made** — most recent architectural decision, prevents re-debating on resume
6. **Context That Would Be Lost** — anything known now that won't be obvious from reading files

### On session start — before any other action:
1. Read `SESSION.md` — one read, full state
2. Read `TASK.md` — task list and completion status
3. State the resumption point out loud
4. Ask one clarifying question if anything is ambiguous
5. Only then begin work

### Hard rules:
- Never let SESSION.md go more than 5 turns without an update
- Never start work on resume without reading SESSION.md first
- If SESSION.md is missing or blank, stop and ask — do not guess
- "What's Done" is append-only — never overwrite history
- After any git commit, update SESSION.md immediately regardless of turn count

---

## 7. File & Read Discipline

**Read only what you need. Batch everything.**

- Before reading any file, state what specific information you need from it
- Read only the relevant section/function — not the whole file
- Never explore more than 3 files to answer a question; stop and ask if you need more
- Batch all bash/grep/ls/cat/head/tail into a single script — never chain individual calls
- Prefer `grep` + targeted `head`/`tail` over `cat` on large files

---

## 8. Task Management

**Spec first. Create once. Never patch immediately.**

- Before writing any code, produce a `TASK.md` with numbered atomic tasks (each <30 min)
- Wait for approval, then execute top-to-bottom
- Pre-populate task specs completely before creating — never create then immediately update
- After each task: mark done in `TASK.md`, run build to verify, commit with `task N: <summary>`
- If a response will exceed 300 lines, summarize and ask before continuing

---

## 9. Brainstorming

**Cap turns. Force convergence. Always produce a SPEC.**

- Never brainstorm without a concrete decision stated upfront
- Cap sessions at 8 turns
- Never present more than 3 options — recommend one and defend it
- If no decision by turn 8, write a SPEC.md summarizing options and tradeoffs, then stop
- Every brainstorm session MUST end with a SPEC.md written to the project root
- No SPEC.md = session failed — do not proceed to implementation
- Use template from `~/.claude/templates/SPEC.md`

---

## 10. Exploration & Delegation

**Delegate first. Main agent synthesizes only.**

- All file reading, grep work, and research must be delegated to sub-agents
- Main agent receives summaries — never raw file contents
- Sub-agent budget: up to 10 tool calls per delegation task
- If you need to explore more than 1 directory or 3 files, delegate — don't wander
- State the goal of any exploration before starting
- Ask all clarifying questions before delegating, not during

---

## 11. Server & Runtime

**Verify before claiming it works.**

- Before starting a dev server, kill existing processes on the target port:
  `lsof -ti:<PORT> | xargs kill -9`
- After starting the app, curl `/health`, `/api-docs`, and `/openapi.json`
- Report status codes and first 200 chars of each response before claiming success
- After regenerating OpenAPI/Swagger specs, restart the dev server

---

## 12. Project Deliverables

**Scaffold completely. Never produce partial artifacts.**

New backend/microservice:
1. Full implementation files
2. `CLAUDE.md` with run/test instructions
3. `SESSION.md` initialized

New frontend/UI project:
1. Full implementation files
2. `CLAUDE.md` with run/test/build instructions
3. `.env.example` with all required environment variables
4. `SESSION.md` initialized

Only produce Docker setup or CI/CD config when explicitly requested.

---

## 13. Self-Improvement

**Log failures. Fold back monthly.**

- After any session with a notable mistake: run `log-learning` with what failed, root cause, and rule to add
- Monthly: review `~/.claude/LEARNINGS.md` — promote repeated patterns into this file
- If the same mistake appears twice in LEARNINGS.md, it becomes a rule here immediately

---

## 14. Response Budget

**One sentence of reasoning per decision. No over-explaining.**

- Task completion output: status, files changed, next step — nothing else
- Never over-explain — if the user can infer it, don't say it
- Prefer fewer, larger operations over many small ones
- Batch related reads/writes together

---

**These rules are working if:** SESSION.md is always current, cold-starts take 2 reads not 10, diffs contain only requested changes, and brainstorming sessions end with a SPEC.
