import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, TenantContextService } from '@saas-skeleton/database';
import { AccessTokenService, type VerifiedAccessToken } from '../auth/access-token.service';
import { RealtimeAuthError } from './realtime.errors';
import type { RealtimeSocketData, TenantSocket } from './realtime.types';

/**
 * Автентифікація socket-зʼєднання.
 *
 * Чому не `JwtAuthGuard`: guard живе в HTTP-контексті (`ExecutionContext.switchToHttp`),
 * а `TenantResolutionMiddleware` піднімає CLS на express-запит. Handshake сокета —
 * не express-запит, і CLS-контексту для нього ніхто не створює. Тому tenant-контекст
 * тут піднімається явно, а перевірка самого токена делегується спільному
 * `AccessTokenService` — щоб правила не роздвоїлись.
 */
@Injectable()
export class SocketAuthService {
  private readonly logger = new Logger(SocketAuthService.name);

  constructor(
    private readonly accessTokenService: AccessTokenService,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** Handshake: токен → identity + перевірка, що і юзер, і тенант досі активні */
  async authenticate(socket: TenantSocket): Promise<RealtimeSocketData> {
    const token = this.extractToken(socket);
    if (!token) {
      throw new RealtimeAuthError('UNAUTHENTICATED', 'Missing access token');
    }
    const payload = await this.verify(token);
    await this.assertActive(payload);
    return this.toSocketData(payload);
  }

  /**
   * `auth.update.v1`: у вже відкритому зʼєднанні дозволено рівно одне — продовжити
   * ту саму сесію. Новий токен з іншим `sub`, `tenantId` або `role` — це вже інша
   * identity: сокет уже сидить у room-ах старої, а права могли змінитись, тому
   * перевипуск робиться через новий handshake, а не підміною на льоту.
   *
   * `sid` СВІДОМО не звіряється (research R-11). Вкладка може принести токен іншої
   * сесії цілком легально — наприклад, після зміни пароля або «вийти звідусіль»,
   * коли сервер сам видав їй нову пару. Рвати за це зʼєднання означало б карати
   * юзера за дію, яку він щойно зробив навмисно; замість цього гейтвей просто
   * переводить сокет у room нової сесії.
   */
  async reauthenticate(socket: TenantSocket, token: string): Promise<RealtimeSocketData> {
    const payload = await this.verify(token);
    const current = socket.data;
    if (
      payload.sub !== current.userId ||
      payload.tenantId !== current.tenantId ||
      payload.role !== current.role
    ) {
      throw new RealtimeAuthError('IDENTITY_CHANGED', 'Token identity does not match the socket');
    }
    return this.toSocketData(payload);
  }

  /**
   * Токен їде в Socket.IO `auth`-payload handshake-у, а не в query string: query
   * потрапляє в логи проксі й у referrer, а `auth` — у тіло Engine.IO-пакета.
   */
  private extractToken(socket: TenantSocket): string | undefined {
    const raw = (socket.handshake.auth as { token?: unknown }).token;
    return typeof raw === 'string' && raw !== '' ? raw : undefined;
  }

  private async verify(token: string): Promise<VerifiedAccessToken> {
    try {
      return await this.accessTokenService.verify(token);
    } catch {
      throw new RealtimeAuthError('UNAUTHENTICATED', 'Invalid or expired access token');
    }
  }

  /**
   * Ті самі перевірки, що в login/refresh: заблокований юзер або призупинений
   * тенант не має тримати живий socket. Читання йде в tenant-CLS, тому RLS
   * (MT-2) сама відсіче токен, підписаний для іншого тенанта — рядка просто не буде.
   */
  private async assertActive(payload: VerifiedAccessToken): Promise<void> {
    const user = await this.tenantContext.runWith(payload.tenantId, () =>
      this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: { tenant: true },
      }),
    );

    if (!user || !user.isActive || !user.tenant.isActive) {
      this.logger.warn(`Socket handshake rejected for user ${payload.sub} (inactive or unknown)`);
      throw new RealtimeAuthError('ACCOUNT_INACTIVE', 'Account is deactivated');
    }
  }

  private toSocketData(payload: VerifiedAccessToken): RealtimeSocketData {
    if (typeof payload.exp !== 'number') {
      // Токен без exp жив би на сокеті вічно — це гірше за відмову
      throw new RealtimeAuthError('UNAUTHENTICATED', 'Access token has no expiration');
    }
    return {
      userId: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
      sid: payload.sid,
      expiresAtMs: payload.exp * 1000,
    };
  }
}
