# Agents

Subagent definitions available to Claude Code in this repository.

`code-reviewer.md`, `architect.md` and `code-architect.md`, plus the
`/ecc-code-review` command, come from [ECC](https://github.com/affaan-m/ecc)
(MIT, Affaan Mustafa) and are vendored here rather than installed as a plugin:
the plugin ships 71 agents, 314 skills and lifecycle hooks, and this repo only
wants the review pair.

`/ecc-architecture-review` is local — ECC has no architecture-review command, so
it drives the `architect` agent against this repo's own baseline (`AGENTS.md`,
`docs/`, `modules.config.ts`, `openspec/specs/`).

| File | Role | Invoke |
| --- | --- | --- |
| `code-reviewer.md` | reviews a diff for correctness, security, quality | `/ecc-code-review` or the Agent tool |
| `architect.md` | reviews system architecture, drift, scalability | `/ecc-architecture-review` or the Agent tool |
| `code-architect.md` | designs a blueprint for a new feature | Agent tool |

Vendored files keep their upstream content; update them by re-copying from
upstream, not by editing in place.
