-- CreateEnum
CREATE TYPE "ConversationKind" AS ENUM ('INTERNAL', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PENDING', 'SNOOZED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('TEXT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageVisibility" AS ENUM ('PUBLIC', 'INTERNAL');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- AlterTable
ALTER TABLE "activities" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "activity_links" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "ai_conversations" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "ai_messages" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "attachments" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "auth_sessions" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "calendar_event_attendees" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "calendar_events" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "calendar_reminders" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "customer_contacts" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "customers" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "files" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "number_sequences" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "number_series" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "scheduled_notifications" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- AlterTable
ALTER TABLE "verification_tokens" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "kind" "ConversationKind" NOT NULL DEFAULT 'INTERNAL',
    "access" TEXT NOT NULL DEFAULT 'private',
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMP(3),
    "last_message_preview" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "conversation_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "join_seq" INTEGER NOT NULL DEFAULT 0,
    "last_read_seq" INTEGER NOT NULL DEFAULT 0,
    "last_read_at" TIMESTAMP(3),
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id'::text, true), ''::text),
    "conversation_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "MessageKind" NOT NULL,
    "visibility" "MessageVisibility" NOT NULL DEFAULT 'PUBLIC',
    "sender_type" TEXT NOT NULL,
    "sender_user_id" TEXT,
    "sender_label" TEXT,
    "body" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "client_message_id" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'SENT',
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_tenant_id_last_message_at_idx" ON "conversations"("tenant_id", "last_message_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_tenant_id_id_key" ON "conversations"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "conversation_participants_tenant_id_user_id_left_at_idx" ON "conversation_participants"("tenant_id", "user_id", "left_at");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_tenant_id_conversation_id_seq_key" ON "chat_messages"("tenant_id", "conversation_id", "seq");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversations"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversations"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Часткові унікальні індекси — Prisma їх не вміє, тому руками (той самий прийом,
-- що ai_conversations_active_per_user_key).
-- ============================================================================

-- Ідемпотентність надсилання. АРБІТР, а не перевірка в коді: подвійний тап і
-- ретрай axios приходять паралельно, і перевірка «чи вже є такий» їх не ловить.
-- Частковий — бо client_message_id немає в системних записів (docs/chat.md §4.5)
CREATE UNIQUE INDEX "chat_messages_client_message_id_key"
  ON "chat_messages" ("tenant_id", "conversation_id", "client_message_id")
  WHERE "client_message_id" IS NOT NULL;

-- Рівно один дефолтний канал на тенант — обмеження БД, а не угода (design.md D3)
CREATE UNIQUE INDEX "conversations_default_per_tenant_key"
  ON "conversations" ("tenant_id")
  WHERE "is_default";

-- ============================================================================
-- Backfill: дефолтний канал для КОЖНОГО наявного тенанта + членство для кожного
-- наявного юзера. Без цього кроку вже створені тенанти лишились би єдиними без
-- дефолтного каналу — сід їх не полагодить (він працює тільки зі своїм тенантом).
--
-- Цикл по тенантах із ЯВНИМ tenant-контекстом — не набірні INSERT..SELECT.
-- Причина не в стилі: `users` (як і ці три таблиці) під FORCE ROW LEVEL SECURITY,
-- а FORCE діє і на ВЛАСНИКА схеми. Тобто saas_migrator без app.tenant_id бачить у
-- `users` НУЛЬ рядків — набірний backfill не впав би, він тихо вставив би нуль
-- учасників. Та сама пастка, що з $executeRaw поза tenant-контекстом
-- (CLAUDE.md, правило 16). set_config(..., true) — транзакційно-локальний,
-- міграція і так іде однією транзакцією.
-- ============================================================================

DO $$
DECLARE
  v_tenant  record;
  v_user    record;
  v_conv_id text;
  v_seq     int;
BEGIN
  FOR v_tenant IN SELECT "id" FROM "tenants" ORDER BY "created_at" LOOP
    PERFORM set_config('app.tenant_id', v_tenant."id", true);

    v_conv_id := gen_random_uuid()::text;

    INSERT INTO "conversations" (
      "id", "tenant_id", "kind", "access", "status", "is_default", "title",
      "last_seq", "created_at", "updated_at"
    ) VALUES (
      v_conv_id, v_tenant."id", 'INTERNAL', 'private', 'OPEN', true, 'General',
      1, now(), now()
    );

    -- Системні записи в стрічку: «розмову створено», далі по одному на кожного
    -- початкового учасника. Відправник — system (жодна людина цих людей не
    -- додавала, це зробила міграція). Текст не зберігається: type + params,
    -- рендер через i18next
    INSERT INTO "chat_messages" (
      "id", "tenant_id", "conversation_id", "seq", "kind", "visibility",
      "sender_type", "payload", "created_at"
    ) VALUES (
      gen_random_uuid()::text, v_tenant."id", v_conv_id, 1, 'SYSTEM', 'PUBLIC', 'system',
      jsonb_build_object('type', 'conversation.created'), now()
    );

    v_seq := 1;

    FOR v_user IN
      SELECT "id", "name", "email" FROM "users"
      WHERE "tenant_id" = v_tenant."id"
      ORDER BY "created_at", "id"
    LOOP
      v_seq := v_seq + 1;

      INSERT INTO "conversation_participants" (
        "conversation_id", "tenant_id", "user_id", "role",
        "join_seq", "last_read_seq", "unread_count", "joined_at"
      ) VALUES (
        v_conv_id, v_tenant."id", v_user."id", 'member', 0, 0, 0, now()
      );

      INSERT INTO "chat_messages" (
        "id", "tenant_id", "conversation_id", "seq", "kind", "visibility",
        "sender_type", "payload", "created_at"
      ) VALUES (
        gen_random_uuid()::text, v_tenant."id", v_conv_id, v_seq, 'SYSTEM', 'PUBLIC', 'system',
        jsonb_build_object(
          'type', 'member.added',
          'member', jsonb_build_object('id', v_user."id",
                                       'label', coalesce(v_user."name", v_user."email"))
        ),
        now()
      );
    END LOOP;

    -- last_message_preview НЕ чіпаємо: у системного запису тексту немає, і прев'ю
    -- лишається NULL до першої справжньої репліки (design.md D5)
    UPDATE "conversations"
    SET "last_seq" = v_seq, "last_message_at" = now(), "updated_at" = now()
    WHERE "id" = v_conv_id;

    -- Приєднання не створює непрочитаних: курсор стартує на останньому записі
    UPDATE "conversation_participants"
    SET "join_seq" = v_seq, "last_read_seq" = v_seq
    WHERE "conversation_id" = v_conv_id;
  END LOOP;

  PERFORM set_config('app.tenant_id', '', true);
END $$;

-- ============================================================================
-- RLS (шаблон MT-2). Гранти тут НЕ потрібні: міграції йдуть під saas_migrator, а
-- `ALTER DEFAULT PRIVILEGES FOR ROLE saas_migrator` (scripts/ensure-roles.ts) уже
-- роздає SELECT/INSERT/UPDATE/DELETE на КОЖНУ нову таблицю цієї ролі.
--
-- RLS тут — межа ТЕНАНТА. Межу учасника (приватний канал не видно навіть ADMIN)
-- тримає сервіс — ОДНА функція доступу на модуль (docs/chat.md §5 п. 6). Це те
-- саме рішення, що для приватних подій календаря і особистих AI-розмов.
-- ============================================================================

ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "conversations"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

ALTER TABLE "conversation_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_participants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "conversation_participants"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));

ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "chat_messages"
  FOR ALL
  USING      ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')))
  WITH CHECK ("tenant_id" = (SELECT nullif(current_setting('app.tenant_id', true), '')));
