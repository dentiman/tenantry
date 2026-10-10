-- Daily question counter per user for the demo limit `AI_QUOTA_USER_DAILY_MESSAGES`
-- (docs/ai-assistant-implementation.md §16). Reserved atomically in `ask()`; token columns are
-- unrelated. ADD COLUMN … DEFAULT backfills existing rows without an UPDATE (FORCE RLS applies
-- to the owner too, so a data migration on tenant rows is not an option).
ALTER TABLE "ai_usage_counters" ADD COLUMN "message_count" INTEGER NOT NULL DEFAULT 0;
