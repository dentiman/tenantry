---
description: Architecture review — scan the whole repository (or a named area) against its declared architecture, report drift, coupling, scalability and maintainability risks. Delegates to the `architect` agent; for a feature blueprint use `code-architect` instead.
argument-hint: "[area or module to scan | blank for the whole repo]"
---

# Architecture Review

> Driver for the ECC `architect` agent (see `.claude/agents/architect.md`).

**Scope**: $ARGUMENTS (blank = whole repository)

---

## Phase 1 — DECLARED ARCHITECTURE

Read what the repo says about itself before reading code:

- `AGENTS.md` / `CLAUDE.md` — conventions, fixed decisions, critical rules
- `docs/` — the architecture references listed in the documentation map
- `modules.config.ts` — the declared module graph, if present
- `openspec/specs/` — behaviour the system is supposed to have

Record the **claimed** architecture: tiers, boundaries, ownership rules,
fixed decisions. This is the baseline every finding is measured against.

## Phase 2 — ACTUAL ARCHITECTURE

Map what the code actually does:

- entry points, apps, libs, and how they depend on each other
- cross-boundary imports (does a lower tier reach up?)
- data ownership (who writes which table)
- transaction and async boundaries
- shared state, registries, slots, and string-keyed links the linter cannot see

Prefer the repo's own checks where they exist (`deps:check`, `modules:check`,
`lint`, `typecheck`) and record their output as evidence rather than guessing.

## Phase 3 — DRIFT ANALYSIS

For each gap between claimed and actual, record:

| Field | Content |
|---|---|
| Area | module / app / lib |
| Claimed | the rule or decision as documented |
| Actual | what the code does, with `file:line` |
| Impact | what breaks, and when |
| Severity | CRITICAL / HIGH / MEDIUM / LOW |

Severity means consequence, not tidiness:

- **CRITICAL** — a boundary that protects correctness or tenant isolation is bypassed
- **HIGH** — a declared invariant is violated and nothing catches it
- **MEDIUM** — known debt that is contained and documented
- **LOW** — naming, layout, or cosmetic inconsistency

Documented debt is not a finding at HIGH. If `docs/` already names it and
accepts it, record it as MEDIUM with the reference.

## Phase 4 — RISK AND SCALABILITY

Independent of drift, assess:

- coupling hot spots — the files most changed together, the modules with most inbound edges
- scalability limits — per-tenant growth, N+1 shapes, unbounded reads, single-writer paths
- failure visibility — what breaks silently (no DLQ surface, no alert, no test)
- operational seams — what has to be done by hand on every deploy or incident

## Phase 5 — REPORT

Write the artifact to `.claude/reviews/architecture-<scope>-<YYYY-MM-DD>.md`:

```markdown
# Architecture Review: <scope>

**Reviewed**: <date>
**Baseline**: <docs read>
**Verdict**: SOUND | DRIFTING | AT RISK

## Summary
<3-5 sentences: what the architecture is, where it holds, where it does not>

## Drift Findings
### CRITICAL / HIGH / MEDIUM / LOW
<table rows from Phase 3, or "None">

## Risks
| Risk | Trigger | Blast radius | Mitigation |
|---|---|---|---|

## Strengths
<what is deliberately well-built and should not be touched>

## Recommendations
<ordered, each with effort estimate and what it buys>
```

## Phase 6 — OUTPUT

Report to the user: verdict, finding counts by severity, the three highest-value
recommendations, and the artifact path.

---

## Rules

- **Evidence or silence.** Every finding cites `file:line` or a command's output.
- **No speculative redesign.** Do not propose microservices, a new ORM, or a
  different queue unless the repo's own documented pain motivates it.
- **Respect fixed decisions.** A documented "do not revisit" decision is a
  constraint, not a finding.
- **A sound architecture is a valid verdict.** Zero findings is an outcome, not
  a failure to look hard enough.
