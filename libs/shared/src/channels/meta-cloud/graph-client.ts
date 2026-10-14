/**
 * Малий клієнт Graph API (CHAT-3a, design.md D1). Один `fetch`, без SDK: токен — лише в заголовку
 * `Authorization: Bearer` (не в URL, щоб не потрапив у логи й проксі), фіксований таймаут, помилка Graph
 * стає `MetaApiError` із кодом, а текст помилки проходить редактор, бо Meta інколи повертає частину
 * того, що їй надіслали. Клієнт сам нічого не пише: кожен виклик звітує в `onCall`, звідки живиться журнал.
 */

export type GraphMethod = 'GET' | 'POST';

export interface GraphCall {
  operation: string;
  method: GraphMethod;
  /** Шлях БЕЗ query: у query може бути токен чи id */
  path: string;
  /** HTTP-статус; `null` — відповіді не було (мережа, таймаут) */
  status: number | null;
  durationMs: number;
  errorCode: string | null;
  errorTitle: string | null;
}

export interface GraphClientOptions {
  baseUrl?: string;
  version?: string;
  timeoutMs?: number;
  onCall?: (call: GraphCall) => void;
}

export interface GraphRequest {
  method: GraphMethod;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  /** Токен для заголовка: користувацький/системний або app-токен `APP_ID|APP_SECRET` */
  token: string;
  /** Інші секрети, які не мають потрапити в текст помилки (наприклад, окремо токен, коли bearer — app-токен) */
  alsoRedact?: readonly string[];
  operation: string;
  /** Зовнішній сигнал скасування (таймаут відправки з доставки); додається до власного таймауту клієнта */
  signal?: AbortSignal;
}

export interface GraphResponse<T = Record<string, unknown>> {
  status: number;
  body: T;
}

/** Помилка Graph або транспорту. `title` вже очищено від секретів і обрізано */
export class MetaApiError extends Error {
  constructor(
    readonly kind: 'api' | 'network' | 'timeout',
    readonly httpStatus: number | null,
    readonly code: number | null,
    readonly subcode: number | null,
    readonly title: string,
    readonly fbtraceId: string | null,
    readonly retryAfterSeconds?: number,
  ) {
    super(`meta ${kind} ${String(httpStatus ?? '-')} ${String(code ?? '-')}: ${title}`);
    this.name = 'MetaApiError';
  }
}

const DEFAULT_BASE_URL = 'https://graph.facebook.com';
const DEFAULT_VERSION = 'v23.0';
const DEFAULT_TIMEOUT_MS = 10_000;
const TITLE_MAX = 200;
/** Найкоротший шматок секрету, який ще редагуємо: коротші збіги випадкові й нашкодили б тексту */
const MIN_REDACT = 10;

/**
 * Прибирає секрет із тексту: повністю, а також будь-який його префікс чи суфікс довжиною від
 * `MIN_REDACT` (Meta інколи ехо-повертає «хвіст» токена). Довші збіги шукаються першими.
 */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < MIN_REDACT) continue;
    for (let length = secret.length; length >= MIN_REDACT; length -= 1) {
      for (const piece of [secret.slice(0, length), secret.slice(-length)]) {
        if (out.includes(piece)) out = out.split(piece).join('***');
      }
    }
  }
  return out;
}

export class MetaGraphClient {
  private readonly timeoutMs: number;
  private readonly onCall: ((call: GraphCall) => void) | undefined;

  constructor(private readonly options: GraphClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onCall = options.onCall;
  }

  /** Читається на кожен запит, а не в конструкторі: тест вказує стаб уже після побудови адаптера */
  private base(): string {
    const baseUrl = (
      this.options.baseUrl ??
      process.env.META_GRAPH_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    const version = this.options.version ?? process.env.META_GRAPH_VERSION ?? DEFAULT_VERSION;
    return `${baseUrl}/${version}`;
  }

  async request<T = Record<string, unknown>>(request: GraphRequest): Promise<GraphResponse<T>> {
    const url = new URL(`${this.base()}/${request.path.replace(/^\/+/, '')}`);
    for (const [key, value] of Object.entries(request.query ?? {})) {
      url.searchParams.set(key, value);
    }
    const secrets = [request.token, ...(request.alsoRedact ?? [])];
    const started = Date.now();
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = request.signal ? AbortSignal.any([timeout, request.signal]) : timeout;

    const report = (status: number | null, error: MetaApiError | null): void => {
      this.onCall?.({
        operation: request.operation,
        method: request.method,
        path: request.path,
        status,
        durationMs: Date.now() - started,
        errorCode: error ? (error.code !== null ? String(error.code) : error.kind) : null,
        errorTitle: error ? error.title : null,
      });
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: request.method,
        headers: {
          Authorization: `Bearer ${request.token}`,
          ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        signal,
      });
    } catch (cause) {
      const aborted =
        cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError');
      const error = new MetaApiError(
        aborted ? 'timeout' : 'network',
        null,
        null,
        null,
        aborted ? 'The provider did not answer in time' : 'The provider could not be reached',
        null,
      );
      report(null, error);
      throw error;
    }

    const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok && parsed.error === undefined) {
      report(response.status, null);
      return { status: response.status, body: parsed as T };
    }

    const raw = (parsed.error ?? {}) as {
      message?: unknown;
      code?: unknown;
      error_subcode?: unknown;
      fbtrace_id?: unknown;
      error_data?: { details?: unknown };
    };
    const message =
      typeof raw.message === 'string' ? raw.message : `HTTP ${String(response.status)}`;
    const retryAfter = Number(response.headers.get('retry-after'));
    const error = new MetaApiError(
      'api',
      response.status,
      typeof raw.code === 'number' ? raw.code : null,
      typeof raw.error_subcode === 'number' ? raw.error_subcode : null,
      redactSecrets(message, secrets).slice(0, TITLE_MAX),
      typeof raw.fbtrace_id === 'string' ? raw.fbtrace_id : null,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    );
    report(response.status, error);
    throw error;
  }
}
