import { Module } from '@nestjs/common';
import { ChatNotifier } from './chat-notifier.service';
import { ConversationWorkflow } from './conversation-workflow';

/**
 * Провайдери чату, спільні для api та воркера: сповіщення (`ChatNotifier`) і робочий процес
 * розмови (`ConversationWorkflow`). `NotificationRecorder` і `ActivityRecorder` беруться з глобальних
 * `NotificationsModule`/`ActivitiesModule`. Окремий модуль, а не рядок у тих: інбокс і журнал —
 * платформа й не знають про чат (docs/modules.md, залежності лише вниз).
 */
@Module({ providers: [ChatNotifier, ConversationWorkflow], exports: [ChatNotifier, ConversationWorkflow] })
export class ChatSharedModule {}
