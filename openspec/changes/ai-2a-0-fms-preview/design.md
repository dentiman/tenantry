## Decisions

Reuse the parser/chunker in future ingest. Keep it out of the shared root barrel:
CLI-only ESM parser dependencies and token ranks should not enter API/worker startup.
The manifest is strict Zod; document frontmatter permits unrelated FMS metadata.
Audience mapping is explicit and deny-by-default; root-only pages have no tenant role.
Source revision is a deterministic hash of policy, parser profile and admitted file hashes.
Use local bundled cl100k_base ranks, no tokenizer download or external calls.
Split at Unicode character boundaries, then recount the complete embedding text.
Chunk hashes include the heading prefix; tokenizer counts include overlap.
The default CLI report omits content; `--include-content` explicitly includes it.
Default status policy requires exact path/hash, reviewer and an unexpired date for draft approval.
The owner requested an explicit all-for-testing FMS profile: statuses/draft flags are
ignored, Russian translations and technical types/areas are excluded, and known
audiences map to ADMIN. Publication, filesystem and metadata checks still apply.

Local development data is disposable by explicit user instruction. Replace only
saas-skeleton_pgdata, run db:reset and leave the requested dev services running.
