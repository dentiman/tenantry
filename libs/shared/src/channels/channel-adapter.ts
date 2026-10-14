import type { ChannelProvider, ChannelType, NormalizedEvent } from '@saas-skeleton/contracts';
import type { OutboundContext } from './channel-send';

/**
 * Контракт адаптера каналу (docs/whatsapp-channel.md §4.2). Ядро вимагає мінімум; решта
 * можливостей (шаблони, медіа, здоров'я, підключення, прочитано) — окремі опційні
 * інтерфейси, які додають фази 2b/3a/3b і яких тут свідомо немає.
 *
 * Адаптер отримує СИРІ БАЙТИ й заголовки: підпис вебхука рахується над точними байтами, і
 * будь-яке «розібрали й зібрали назад» ламає перевірку.
 */

export interface RawWebhookRequest {
  /** Заголовки в нижньому регістрі */
  headers: Readonly<Record<string, string | undefined>>;
  /** Точні байти тіла так, як їх надіслав провайдер */
  body: Buffer;
}

/** Розшифровані облікові дані акаунта, потрібні адаптеру */
export interface ChannelCredentials {
  /** Ключ підпису вебхука (Meta: App secret) */
  appSecret: string | null;
  /** Токен рукостискання GET — свій у кожного акаунта */
  verifyToken: string;
  accessToken: string | null;
}

export interface ParseResult {
  events: NormalizedEvent[];
  /**
   * Тіло не вдалося розібрати зовсім («отруйний» payload): не кидаємо, а повідомляємо, щоб
   * ядро зберегло подію як FAILED і все одно відповіло провайдеру 200.
   */
  error?: string;
}

export interface ChannelCapabilities {
  /** Вікно вільного тексту, годин; відсутнє — вікна немає */
  freeformWindowHours?: number;
  maxTextLength: number;
  /** Чи вміє адаптер слати схвалений шаблон за іменем і мовою (CHAT-3a) */
  templates: boolean;
  /**
   * Хто вирішує, чи вікно вільного тексту закрите, поки нема даних про останнє повідомлення клієнта
   * (CHAT-3a, design.md D6): `local` — ми (немає вхідного → закрите); `provider` — провайдер: нашу
   * перевірку пропускаємо, а його відмову класифікуємо як `WINDOW_CLOSED`. Коли час останнього
   * повідомлення клієнта відомий, діє локальне правило для всіх.
   */
  windowEnforcement: 'local' | 'provider';
}

export interface ChannelAdapter {
  readonly provider: ChannelProvider;
  readonly type: ChannelType;
  readonly capabilities: ChannelCapabilities;

  /** Підпис над СИРИМИ байтами; `false` на відсутній чи невірний підпис, ніколи не кидає */
  verifyWebhook(req: RawWebhookRequest, creds: ChannelCredentials): boolean;

  /** Рукостискання GET: рядок-відповідь або `null`, якщо запит недійсний */
  handshake(
    query: Readonly<Record<string, string | undefined>>,
    creds: ChannelCredentials,
  ): string | null;

  /** 0..N подій: провайдери батчать. Ніколи не кидає */
  parseWebhook(raw: Buffer): ParseResult;

  /**
   * Надіслати текст (CHAT-2b). Успіх повертає id повідомлення в провайдера; відмову кидає як
   * `ChannelSendError` із класом. Поважає `ctx.signal`: після таймауту має перервати запит.
   */
  send(ctx: OutboundContext, creds: ChannelCredentials): Promise<{ externalId: string }>;
}
