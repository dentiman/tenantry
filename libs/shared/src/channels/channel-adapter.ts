import type { ChannelProvider, ChannelType, NormalizedEvent } from '@saas-skeleton/contracts';

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
}

export interface ChannelAdapter {
  readonly provider: ChannelProvider;
  readonly type: ChannelType;
  readonly capabilities: ChannelCapabilities;

  /** Підпис над СИРИМИ байтами; `false` на відсутній чи невірний підпис, ніколи не кидає */
  verifyWebhook(req: RawWebhookRequest, creds: ChannelCredentials): boolean;

  /** Рукостискання GET: рядок-відповідь або `null`, якщо запит недійсний */
  handshake(query: Readonly<Record<string, string | undefined>>, creds: ChannelCredentials): string | null;

  /** 0..N подій: провайдери батчать. Ніколи не кидає */
  parseWebhook(raw: Buffer): ParseResult;
}
