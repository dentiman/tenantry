import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  CHAT_MAX_VIEWED_CONVERSATIONS,
  CHAT_SOCKET_EVENTS,
  CHAT_CLIENT_SOCKET_EVENTS,
  CHAT_TYPING_TTL_MS,
  conversationRoom,
  conversationRoomPrefix,
} from '@saas-skeleton/contracts';
import { ClientEventRegistry } from '../realtime/client-event.registry';
import { SocketEventError } from '../realtime/realtime.errors';
import { ChatService } from './chat.service';
import { ConversationAccessService } from './conversation-access.service';

/**
 * Події чату client → server (docs/chat.md §4.8.2): що кому дозволено говорити серверу через
 * сокет. Реєструються в `ClientEventRegistry` realtime-шару, який сам робить валідацію,
 * ліміт, tenant-контекст і нормалізацію відмов — тут лише рішення чату.
 *
 * Три речі, на яких усе тримається:
 *
 * 1. **Доступ перевіряється один раз — на підписці.** Саме `chat.subscribe.v1` проходить
 *    через єдину функцію доступу чату; потім членство в room-і розмови САМЕ ЩО і є доказом,
 *    тож typing не ходить у БД. Клієнт ніколи не називає room — лише `conversationId`, а room
 *    формує сервер.
 * 2. **Room — не канал доставки повідомлень.** `message-created` іде в особисті room-и (0.2a),
 *    тож пропущена чи відмовлена підписка коштує індикатора набору, а не повідомлення.
 * 3. **Прочитане — той самий `ChatService.markRead`, що й у REST.** Ефект, обмеження і
 *    відлуння в інші вкладки спільні за побудовою, а не за домовленістю двох реалізацій.
 *
 * Відома прогалина, яку закриє CHAT-0.3: учасник, якого заберуть із розмови, лишиться в її
 * room-і до відʼєднання. Видалення учасників зʼявиться саме там, і разом із ним — вихід із
 * room-у (`RealtimeEmitter.removeUserFromRoom`, design.md D2 фази 0.2b).
 */
@Injectable()
export class ChatSocketHandlers implements OnModuleInit {
  constructor(
    private readonly registry: ClientEventRegistry,
    private readonly access: ConversationAccessService,
    private readonly chat: ChatService,
  ) {}

  onModuleInit(): void {
    const events = CHAT_CLIENT_SOCKET_EVENTS;

    this.registry.register(events.chatSubscribe, async ({ socket, userId, tenantId, payload }) => {
      // Спершу доступ, потім ліміт: не-учасник завжди чує «не знайдено», а не «забагато» —
      // інакше відповідь розрізняла б існуючу розмову від неіснуючої
      await this.access.assertParticipant(payload.conversationId, userId);

      const room = conversationRoom(tenantId, payload.conversationId);
      if (!socket.rooms.has(room)) {
        const prefix = conversationRoomPrefix(tenantId);
        const held = [...socket.rooms].filter((name) => name.startsWith(prefix)).length;
        if (held >= CHAT_MAX_VIEWED_CONVERSATIONS) {
          throw new SocketEventError('LIMIT_EXCEEDED', 'Too many viewed conversations');
        }
      }
      await socket.join(room);
      return { conversationId: payload.conversationId };
    });

    this.registry.register(events.chatUnsubscribe, async ({ socket, tenantId, payload }) => {
      // Вийти з room-у прав не потребує і нічого не розкриває: не був у ньому — no-op
      await socket.leave(conversationRoom(tenantId, payload.conversationId));
      return {};
    });

    this.registry.register(
      events.chatTyping,
      ({ socket, userId, tenantId, payload }) => {
        const room = conversationRoom(tenantId, payload.conversationId);
        // Доступ уже доведено підпискою: членство в room-і і є дозволом, БД тут не чіпаємо
        if (!socket.rooms.has(room)) {
          throw new SocketEventError('FORBIDDEN', 'Socket is not viewing the conversation');
        }
        // `socket.to` виключає лише цей сокет: інші вкладки того самого юзера теж отримають
        // подію, і клієнт відкидає її за власним `userId`
        socket.to(room).emit(CHAT_SOCKET_EVENTS.chatTypingChanged.name, {
          conversationId: payload.conversationId,
          userId,
          expiresInMs: CHAT_TYPING_TTL_MS,
        });
        return {};
      },
      // Клієнт шле імпульс раз на 3 с; п'ять за 10 с — із запасом, решта — потік
      { rateLimit: { limit: 5, windowMs: 10_000 } },
    );

    this.registry.register(
      events.chatRead,
      async ({ userId, payload }) => {
        await this.chat.markRead(userId, payload.conversationId, payload.seq);
        return {};
      },
      // Жива розмова рухає курсор на кожне нове повідомлення; 20/10 с було б тісно для каналу,
      // де пишуть частіше двох реплік на секунду
      { rateLimit: { limit: 30, windowMs: 10_000 } },
    );
  }
}
