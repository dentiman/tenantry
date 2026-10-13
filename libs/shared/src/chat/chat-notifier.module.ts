import { Module } from '@nestjs/common';
import { ChatNotifier } from './chat-notifier.service';

/**
 * Провайдер сповіщень чату для процесів, що їх пишуть (воркер). `NotificationRecorder` береться з
 * глобального `NotificationsModule`. Окремий модуль, а не рядок у `NotificationsModule`: інбокс —
 * платформа й не знає про чат (docs/modules.md, залежності лише вниз).
 */
@Module({ providers: [ChatNotifier], exports: [ChatNotifier] })
export class ChatNotifierModule {}
