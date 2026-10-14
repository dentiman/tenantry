import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService, TenantTransactions } from '@saas-skeleton/database';
import type { Prisma } from '@saas-skeleton/database';
import type {
  AdminChannelResponse,
  ChannelLogEntry,
  ConnectMessagingAccount,
  MessagingAccountResponse,
  SyncResult,
  UpdateAccountCredentials,
  UpdateChannel,
} from '@saas-skeleton/contracts';
import {
  ChannelLogService,
  CryptoService,
  MetaApiError,
  MetaGraphClient,
  type LogDetail,
} from '@saas-skeleton/shared';
import { ADMIN_CHANNEL_SELECT, toAdminChannelResponse } from './channel.mapper';
import { MessagingAccountService } from './messaging-account.service';

const PROVIDER = 'meta_cloud';
const REQUIRED_SCOPES = ['whatsapp_business_management', 'whatsapp_business_messaging'] as const;
const PHONE_FIELDS_FULL =
  'id,display_phone_number,verified_name,quality_rating,name_status,status,account_mode,code_verification_status,platform_type,throughput';
/** Мінімальний набір (проба, п.10): якщо Graph відхиляє повний — на іншому WABA поле може не підтримуватись */
const PHONE_FIELDS_MIN = 'id,display_phone_number,verified_name,quality_rating';
const MAX_PAGES = 20;

/** Що перевірка встановила про токен */
interface Verdict {
  name: string;
  tokenKind: 'SYSTEM_USER' | 'USER' | 'UNKNOWN';
  expiresAt: Date | null;
  scopes: string[];
  verified: boolean;
}

interface VerifyInput {
  wabaId: string;
  accessToken: string;
  appId?: string | undefined;
  appSecret?: string | undefined;
}

interface PhoneNumber {
  id?: unknown;
  display_phone_number?: unknown;
  verified_name?: unknown;
  quality_rating?: unknown;
  name_status?: unknown;
  status?: unknown;
  account_mode?: unknown;
  code_verification_status?: unknown;
  platform_type?: unknown;
  throughput?: unknown;
}

function fieldError(
  field: string,
  code: string,
  message: string,
  params?: Record<string, string>,
): BadRequestException {
  return new BadRequestException({
    message,
    fieldErrors: [{ field, message, code, ...(params && { params }) }],
  });
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/**
 * Підключення WhatsApp Business акаунта тенанта (CHAT-3a, design.md D2, D3, D11). Адмін дає WABA id і токен
 * (+ за бажанням app id/secret); перевірка в Meta — ДО збереження, а виклики до Meta ніколи не сидять у
 * транзакції. Токен шифрується, не повертається і не логується; вердикт провайдера (поганий токен,
 * немає доступу, бракує права) — `400` з `fieldErrors`, збій самого провайдера — `503`.
 */
@Injectable()
export class WhatsAppConnectionService {
  private readonly logger = new Logger(WhatsAppConnectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TenantTransactions,
    private readonly crypto: CryptoService,
    private readonly logs: ChannelLogService,
    private readonly accounts: MessagingAccountService,
  ) {}

  // -------------------------------------------------------------------------
  // Підключення
  // -------------------------------------------------------------------------

  async connect(dto: ConnectMessagingAccount): Promise<MessagingAccountResponse> {
    if (
      await this.prisma.messagingAccount.findFirst({
        where: { provider: PROVIDER },
        select: { id: true },
      })
    ) {
      throw new ConflictException(
        'A WhatsApp account is already connected; update its token instead',
      );
    }

    const started = Date.now();
    const verdict = await this.verify(dto);
    const durationMs = Date.now() - started;

    let accountId: string;
    try {
      accountId = await this.transactions.withTenantTx(async (tx) => {
        const account = await tx.messagingAccount.create({
          data: {
            provider: PROVIDER,
            name: verdict.name,
            externalId: dto.wabaId,
            credentials: this.crypto.encrypt(dto.accessToken),
            appSecret: dto.appSecret ? this.crypto.encrypt(dto.appSecret) : null,
            appId: dto.appId ?? null,
            // Адреса й токен рукостискання потрібні вебхуку (3b); генеруються тут, як для будь-якого акаунта
            verifyToken: randomBytes(16).toString('hex'),
            webhookKey: randomBytes(16).toString('hex'),
            ...this.tokenFields(verdict),
            status: 'CONNECTED',
          },
          select: { id: true },
        });
        await this.logs.record(tx, {
          accountId: account.id,
          operation: 'verify',
          ok: true,
          httpStatus: 200,
          durationMs,
          detail: { endpoint: dto.wabaId },
          secrets: [dto.accessToken, dto.appSecret ?? ''],
        });
        return account.id;
      });
    } catch (error) {
      // Два одночасні підключення: переможець один (UNIQUE (tenant, provider))
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'A WhatsApp account is already connected; update its token instead',
        );
      }
      throw error;
    }

    // Робочий токен не викидається через збій списку номерів: акаунт лишається, а «Refresh» повторить
    await this.sync(accountId).catch((error: unknown) => {
      this.logger.warn(
        `Initial number sync failed for account ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    return this.accounts.getOne(accountId);
  }

  async reauthenticate(
    accountId: string,
    dto: UpdateAccountCredentials,
  ): Promise<MessagingAccountResponse> {
    const account = await this.loadAccount(accountId);
    if (!account.externalId) {
      throw new ConflictException('The account has no WABA id');
    }
    // Пару app id + секрет можна не повторювати: беремо збережену
    const appId = dto.appId ?? account.appId ?? undefined;
    const appSecret =
      dto.appSecret ?? (account.appSecret ? this.crypto.decrypt(account.appSecret) : undefined);

    const started = Date.now();
    let verdict: Verdict;
    try {
      verdict = await this.verify({
        wabaId: account.externalId,
        accessToken: dto.accessToken,
        appId,
        appSecret,
      });
    } catch (error) {
      await this.logVerify(accountId, false, Date.now() - started, error, [
        dto.accessToken,
        appSecret ?? '',
      ]);
      throw error;
    }

    await this.transactions.withTenantTx(async (tx) => {
      await tx.messagingAccount.update({
        where: { id: accountId },
        data: {
          credentials: this.crypto.encrypt(dto.accessToken),
          ...(dto.appId &&
            dto.appSecret && { appId: dto.appId, appSecret: this.crypto.encrypt(dto.appSecret) }),
          name: verdict.name,
          ...this.tokenFields(verdict),
          status: 'CONNECTED',
          lastError: null,
        },
      });
      await this.logs.record(tx, {
        accountId,
        operation: 'verify',
        ok: true,
        httpStatus: 200,
        durationMs: Date.now() - started,
        detail: { endpoint: account.externalId ?? '' },
        secrets: [dto.accessToken, appSecret ?? ''],
      });
    });
    return this.accounts.getOne(accountId);
  }

  /** Відключення: токен і секрет зникають, історія лишається; подальші відправки падають як неавторизовані */
  async disconnect(accountId: string): Promise<MessagingAccountResponse> {
    await this.loadAccount(accountId);
    await this.transactions.withTenantTx(async (tx) => {
      await tx.messagingAccount.update({
        where: { id: accountId },
        data: {
          credentials: null,
          appSecret: null,
          tokenKind: null,
          tokenExpiresAt: null,
          tokenCheckedAt: null,
          scopes: [],
          status: 'DISABLED',
          lastError: null,
        },
      });
    });
    return this.accounts.getOne(accountId);
  }

  // -------------------------------------------------------------------------
  // Номери
  // -------------------------------------------------------------------------

  /** Читає номери акаунта з Meta й зводить їх у `channels` (design.md D3) */
  async sync(accountId: string): Promise<SyncResult> {
    const account = await this.loadAccount(accountId);
    if (account.credentials === null || account.externalId === null) {
      throw new ConflictException('The account has no credentials; connect it first');
    }
    const token = this.crypto.decrypt(account.credentials);
    const wabaId = account.externalId;
    const started = Date.now();

    let numbers: PhoneNumber[];
    let pages: number;
    try {
      ({ numbers, pages } = await this.readPhoneNumbers(wabaId, token));
    } catch (error) {
      await this.failSync(accountId, started, error, token);
      throw this.toHttpError(error, 'accessToken');
    }

    const result = await this.applyNumbers(accountId, numbers);
    await this.transactions.withTenantTx(async (tx) => {
      await tx.messagingAccount.update({
        where: { id: accountId },
        data: { lastSyncAt: new Date(), lastError: null },
      });
      await this.logs.record(tx, {
        accountId,
        operation: 'sync',
        ok: true,
        httpStatus: 200,
        durationMs: Date.now() - started,
        detail: {
          endpoint: `${wabaId}/phone_numbers`,
          pages,
          numbers: numbers.length,
        } satisfies LogDetail,
      });
    });
    return result;
  }

  private async readPhoneNumbers(
    wabaId: string,
    token: string,
  ): Promise<{ numbers: PhoneNumber[]; pages: number }> {
    const client = new MetaGraphClient();
    let fields = PHONE_FIELDS_FULL;
    const numbers: PhoneNumber[] = [];
    let after: string | undefined;
    let pages = 0;

    while (pages < MAX_PAGES) {
      let page: { data?: PhoneNumber[]; paging?: { cursors?: { after?: string }; next?: string } };
      try {
        ({ body: page } = await client.request({
          method: 'GET',
          path: `${wabaId}/phone_numbers`,
          query: { fields, limit: '50', ...(after ? { after } : {}) },
          token,
          operation: 'sync',
        }));
      } catch (error) {
        // Якщо Graph відхилив повний набір полів (на іншому WABA вони можуть не підтримуватись) — один раз
        // пробуємо мінімальний (проба, п.10); інші помилки — як є
        if (
          error instanceof MetaApiError &&
          error.code === 100 &&
          fields !== PHONE_FIELDS_MIN &&
          pages === 0
        ) {
          fields = PHONE_FIELDS_MIN;
          continue;
        }
        throw error;
      }
      pages += 1;
      numbers.push(...(page.data ?? []));
      after = page.paging?.next ? page.paging.cursors?.after : undefined;
      if (!after) break;
    }
    return { numbers, pages };
  }

  /** Кожен номер — своя коротка транзакція: порушення унікальності (номер чужого тенанта) не валить решту */
  private async applyNumbers(accountId: string, numbers: PhoneNumber[]): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0, missing: 0, skipped: [] };
    const seen: string[] = [];

    for (const number of numbers) {
      const externalId = str(number.id);
      if (!externalId) continue;
      seen.push(externalId);
      const values = {
        displayPhoneNumber: str(number.display_phone_number),
        verifiedName: str(number.verified_name),
        qualityRating: str(number.quality_rating),
        accountMode: str(number.account_mode),
        providerMeta: {
          nameStatus: str(number.name_status),
          codeVerificationStatus: str(number.code_verification_status),
          status: str(number.status),
          platformType: str(number.platform_type),
          throughput: (number.throughput ?? null) as Prisma.InputJsonValue,
        } as Prisma.InputJsonValue,
      };

      try {
        const outcome = await this.transactions.withTenantTx(async (tx) => {
          const existing = await tx.channel.findFirst({
            where: { accountId, externalId },
            select: { id: true },
          });
          if (existing) {
            await tx.channel.update({
              where: { id: existing.id },
              data: { ...values, providerMissingAt: null, syncedAt: new Date() },
            });
            return 'updated' as const;
          }
          // Той самий номер у іншому тенанті: унікальний індекс глобальний, а RLS ховає чужий рядок, тож
          // перевірити наперед не можна — вставляємо й дивимось, чи вставилось
          const inserted = await tx.$queryRaw<{ id: string }[]>`
            INSERT INTO channels (id, account_id, type, provider, external_id, display_phone_number, verified_name,
                                  quality_rating, account_mode, provider_meta, is_enabled, synced_at, updated_at)
            VALUES (gen_random_uuid()::text, ${accountId}, 'WHATSAPP', ${PROVIDER}, ${externalId}, ${values.displayPhoneNumber},
                    ${values.verifiedName}, ${values.qualityRating}, ${values.accountMode},
                    ${JSON.stringify(values.providerMeta)}::jsonb, false, now(), now())
            ON CONFLICT (provider, external_id) WHERE provider_missing_at IS NULL DO NOTHING
            RETURNING id`;
          return inserted.length > 0 ? ('created' as const) : ('other_tenant' as const);
        });
        if (outcome === 'other_tenant') result.skipped.push({ externalId, reason: 'other_tenant' });
        else result[outcome] += 1;
      } catch (error) {
        // Оновлення «повернутого» номера теж може вдаритись об номер чужого тенанта
        if (isUniqueViolation(error)) result.skipped.push({ externalId, reason: 'other_tenant' });
        else throw error;
      }
    }

    // Номер, якого вже нема в провайдера, лишається (там розмови), але недоступний для вибору
    const gone = await this.transactions.withTenantTx((tx) =>
      tx.channel.updateMany({
        where: { accountId, providerMissingAt: null, externalId: { notIn: seen } },
        data: { providerMissingAt: new Date(), isEnabled: false, isDefault: false },
      }),
    );
    result.missing = gone.count;
    return result;
  }

  // -------------------------------------------------------------------------
  // Канали й журнал
  // -------------------------------------------------------------------------

  async updateChannel(channelId: string, dto: UpdateChannel): Promise<AdminChannelResponse> {
    return this.transactions.withTenantTx(async (tx) => {
      const channel = await tx.channel.findUnique({
        where: { id: channelId },
        select: {
          id: true,
          accountId: true,
          isEnabled: true,
          isDefault: true,
          providerMissingAt: true,
        },
      });
      if (!channel) throw new NotFoundException('Channel not found');
      // Серіалізація: два адміни не зроблять два default (partial unique — друга лінія захисту)
      await tx.$queryRaw`SELECT id FROM messaging_accounts WHERE id = ${channel.accountId} FOR UPDATE`;
      const fresh = await tx.channel.findUniqueOrThrow({
        where: { id: channelId },
        select: { isEnabled: true, isDefault: true, providerMissingAt: true },
      });

      const enabled = dto.isEnabled ?? fresh.isEnabled;
      const wantsDefault = dto.isDefault ?? fresh.isDefault;
      if (fresh.providerMissingAt !== null && (dto.isEnabled === true || dto.isDefault === true)) {
        throw new ConflictException('The number no longer exists at the provider');
      }
      if (dto.isDefault === true && !enabled) {
        throw new ConflictException('Only an enabled number can be the default');
      }
      // Вимкнений номер не може лишатись default
      const isDefault = enabled && wantsDefault;

      if (isDefault) {
        await tx.channel.updateMany({
          where: { accountId: channel.accountId, isDefault: true, id: { not: channelId } },
          data: { isDefault: false },
        });
      }
      const updated = await tx.channel.update({
        where: { id: channelId },
        data: { isEnabled: enabled, isDefault },
        select: ADMIN_CHANNEL_SELECT,
      });
      return toAdminChannelResponse(updated);
    });
  }

  async logsOf(
    accountId: string,
    query: { cursor?: string | undefined; limit: number },
  ): Promise<{ items: ChannelLogEntry[]; nextCursor: string | null }> {
    await this.loadAccount(accountId);
    return this.logs.list(accountId, query);
  }

  // -------------------------------------------------------------------------
  // Перевірка токена (design.md D2)
  // -------------------------------------------------------------------------

  private async verify(input: VerifyInput): Promise<Verdict> {
    const client = new MetaGraphClient();
    let tokenKind: Verdict['tokenKind'] = 'UNKNOWN';
    let expiresAt: Date | null = null;
    let scopes: string[] = [];
    let verified = false;

    if (input.appId && input.appSecret) {
      try {
        const { body } = await client.request<{
          data?: {
            is_valid?: unknown;
            app_id?: unknown;
            type?: unknown;
            expires_at?: unknown;
            scopes?: unknown;
          };
        }>({
          method: 'GET',
          path: 'debug_token',
          query: { input_token: input.accessToken },
          // Bearer — app-токен; і сам токен, і секрет не мають лишитись у тексті помилки
          token: `${input.appId}|${input.appSecret}`,
          alsoRedact: [input.accessToken, input.appSecret],
          operation: 'verify',
        });
        const data = body.data ?? {};
        if (data.is_valid !== true) {
          throw fieldError(
            'accessToken',
            'token_invalid',
            'The provider says the token is not valid',
          );
        }
        const reportedApp =
          typeof data.app_id === 'string' || typeof data.app_id === 'number'
            ? String(data.app_id)
            : null;
        if (reportedApp !== null && reportedApp !== input.appId) {
          throw fieldError(
            'appId',
            'token_wrong_app',
            'The token belongs to a different application',
          );
        }
        scopes = Array.isArray(data.scopes)
          ? data.scopes.filter((s): s is string => typeof s === 'string')
          : [];
        const missing = REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope));
        if (missing.length > 0) {
          throw fieldError(
            'accessToken',
            'token_missing_scope',
            `The token lacks the permission ${missing[0] ?? ''}`,
            { scope: missing[0] ?? '' },
          );
        }
        tokenKind = data.type === 'SYSTEM_USER' || data.type === 'USER' ? data.type : 'UNKNOWN';
        const expires = typeof data.expires_at === 'number' ? data.expires_at : 0;
        expiresAt = expires > 0 ? new Date(expires * 1000) : null;
        verified = true;
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        // 190 тут — це про app-токен (хибний секрет), бо про вхідний токен debug_token відповідає 200 з is_valid
        if (error instanceof MetaApiError && error.code === 190) {
          throw fieldError(
            'appSecret',
            'app_secret_invalid',
            'The provider rejected the application id or secret',
          );
        }
        throw this.toHttpError(error, 'accessToken');
      }
    }

    let name = 'WhatsApp Business';
    try {
      const { body } = await client.request<{ name?: unknown }>({
        method: 'GET',
        path: input.wabaId,
        query: { fields: 'id,name,currency,timezone_id,health_status' },
        token: input.accessToken,
        alsoRedact: input.appSecret ? [input.appSecret] : [],
        operation: 'verify',
      });
      name = str(body.name) ?? name;
    } catch (error) {
      throw this.toHttpError(error, 'wabaId');
    }

    return { name, tokenKind, expiresAt, scopes, verified };
  }

  /**
   * Вердикт провайдера → `400` з полем; збій провайдера (5xx, мережа, таймаут) → `503`. `190` — токен
   * недійсний; `100`/`200`/`10` — доступу до WABA немає.
   */
  private toHttpError(error: unknown, tokenField: 'accessToken' | 'wabaId'): Error {
    if (error instanceof BadRequestException || error instanceof ConflictException) return error;
    if (!(error instanceof MetaApiError))
      return error instanceof Error ? error : new Error(String(error));
    if (error.kind !== 'api' || (error.httpStatus ?? 0) >= 500) {
      return new ServiceUnavailableException('The provider is not reachable right now');
    }
    if (error.code === 190)
      return fieldError('accessToken', 'token_invalid', 'The provider says the token is not valid');
    if (
      error.code === 100 ||
      error.code === 200 ||
      error.code === 10 ||
      error.httpStatus === 403 ||
      error.httpStatus === 404
    ) {
      return fieldError(
        'wabaId',
        'waba_no_access',
        'The token has no access to this WhatsApp Business account',
      );
    }
    return fieldError(tokenField, 'token_invalid', error.title);
  }

  private tokenFields(
    verdict: Verdict,
  ): Pick<
    Prisma.MessagingAccountUncheckedCreateInput,
    'tokenKind' | 'tokenExpiresAt' | 'tokenCheckedAt' | 'scopes'
  > {
    return {
      tokenKind: verdict.tokenKind,
      tokenExpiresAt: verdict.expiresAt,
      tokenCheckedAt: new Date(),
      scopes: verdict.scopes,
    };
  }

  private async loadAccount(accountId: string): Promise<{
    id: string;
    externalId: string | null;
    credentials: string | null;
    appSecret: string | null;
    appId: string | null;
  }> {
    const account = await this.prisma.messagingAccount.findFirst({
      where: { id: accountId, provider: PROVIDER },
      select: { id: true, externalId: true, credentials: true, appSecret: true, appId: true },
    });
    if (!account) throw new NotFoundException('Messaging account not found');
    return account;
  }

  private async failSync(
    accountId: string,
    started: number,
    error: unknown,
    token: string,
  ): Promise<void> {
    const authFailed = error instanceof MetaApiError && error.code === 190;
    await this.transactions.withTenantTx(async (tx) => {
      await tx.messagingAccount.update({
        where: { id: accountId },
        data: {
          lastError: error instanceof MetaApiError ? error.title : 'Synchronisation failed',
          ...(authFailed && { status: 'NEEDS_REAUTH' }),
        },
      });
      await this.logs.record(tx, {
        accountId,
        operation: 'sync',
        ok: false,
        httpStatus: error instanceof MetaApiError ? error.httpStatus : null,
        errorCode:
          error instanceof MetaApiError
            ? error.code !== null
              ? String(error.code)
              : error.kind
            : 'error',
        errorTitle: error instanceof MetaApiError ? error.title : 'Synchronisation failed',
        durationMs: Date.now() - started,
        secrets: [token],
      });
    });
  }

  private async logVerify(
    accountId: string,
    ok: boolean,
    durationMs: number,
    error: unknown,
    secrets: string[],
  ): Promise<void> {
    const meta = error instanceof MetaApiError ? error : null;
    const detail =
      error instanceof BadRequestException
        ? (error.getResponse() as { fieldErrors?: { code?: string; message?: string }[] })
            .fieldErrors?.[0]
        : undefined;
    await this.transactions.withTenantTx((tx) =>
      this.logs.record(tx, {
        accountId,
        operation: 'verify',
        ok,
        httpStatus: meta?.httpStatus ?? null,
        errorCode:
          meta?.code !== null && meta?.code !== undefined
            ? String(meta.code)
            : (detail?.code ?? null),
        errorTitle: meta?.title ?? detail?.message ?? null,
        durationMs,
        secrets,
      }),
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}
