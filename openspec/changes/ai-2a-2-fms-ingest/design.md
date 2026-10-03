## Decisions

Reuse the exact preview snapshot and canonical embedding profile. OpenAI/OpenRouter use
1536-dimensional text-embedding-3-small; fake providers exist only in isolated tests.
Each source stores the current run ID/status. A new run supersedes an older one.
Every staging write and publication locks the source row and checks run ownership.
Provider calls occur outside transactions. Staging revisions use unique run IDs;
only a complete manifest changes the active pointer. Failures preserve the active index.
Reuse same-source, same-tenant chunk hashes; persist completed batches for retry.
A successful publication removes superseded and incomplete revisions.
CLI tenant and role arguments are trusted operator inputs, never public API parameters.
