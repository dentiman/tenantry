import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService, TenantTransactions, VerificationPurpose } from '@saas-skeleton/database';
import {
  ActivityRecorder,
  CryptoService,
  MessagePublisher,
  passwordResetRequestedEvent,
} from '@saas-skeleton/shared';
import type { PasswordResetConfirm, PasswordResetRequest } from '@saas-skeleton/contracts';
import * as argon2 from 'argon2';
import { AuthService, type IssuedAuthTokens } from '../auth.service';
import { AuthSessionService } from '../auth-session.service';
import { VerificationTokenService, type TokenUser } from '../verification-token.service';
import type { ClientContextData } from '../../common/client-context.decorator';
import { RealtimeEmitter } from '../../realtime/realtime.emitter';

/**
 * AUTH-3: скидання пароля без оракула — відповідь завжди 204, незалежно від того,
 * чи існує email, чи юзер/тенант активні. Різницю бачить лише лог і черга (публікація
 * події трапляється РІВНО коли є кому слати лист).
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantTx: TenantTransactions,
    private readonly sessions: AuthSessionService,
    private readonly verificationTokens: VerificationTokenService,
    private readonly messages: MessagePublisher,
    private readonly crypto: CryptoService,
    private readonly activities: ActivityRecorder,
    private readonly auth: AuthService,
    private readonly realtime: RealtimeEmitter,
  ) {}

  /**
   * Той самий пошук, що AuthService.login: без явного where по tenantId — скоупить
   * TenantResolutionMiddleware (поле `tenant` у тілі — та сама недовірена підказка).
   * Неіснуючий email, неактивний юзер чи призупинений тенант — 204 без жодного сліду.
   */
  async requestReset(data: PasswordResetRequest, client: ClientContextData): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email: data.email },
      include: { tenant: true },
    });

    if (!user?.passwordHash || !user.isActive || !user.tenant.isActive) {
      this.logger.debug(`Password reset requested for unknown/inactive account: ${data.email}`);
      return;
    }

    await this.tenantTx.withTenantTx(async (tx) => {
      const token = await this.verificationTokens.issue(tx, {
        purpose: VerificationPurpose.PASSWORD_RESET,
        userId: user.id,
        ip: client.ip,
      });

      await this.messages.publish(tx, passwordResetRequestedEvent, {
        userId: user.id,
        tokenEncrypted: this.crypto.encrypt(token),
      });
    });

    this.logger.log(`Password reset requested for ${user.email} (ID: ${user.id})`);
  }

  /**
   * `peek` ДО `consume` (spec FR-033, kill-switch): деактивований юзер чи
   * призупинений тенант отримують ту саму 400, що недійсний токен, і сам токен
   * лишається незвиконаним — legit-власник, реактивований пізніше, зможе
   * повернутись за тим самим лінком.
   */
  async confirmReset(
    data: PasswordResetConfirm,
    client: ClientContextData,
  ): Promise<{ user: TokenUser; tokens: IssuedAuthTokens }> {
    const peeked = await this.verificationTokens.peek(
      VerificationPurpose.PASSWORD_RESET,
      data.token,
    );
    if (!peeked || !peeked.user.isActive || !peeked.user.tenant.isActive) {
      throw new BadRequestException('Invalid or expired token');
    }

    const { user } = peeked;
    const passwordHash = await argon2.hash(data.newPassword);

    await this.tenantTx.withTenantTx(async (tx) => {
      const consumed = await this.verificationTokens.consume(
        tx,
        VerificationPurpose.PASSWORD_RESET,
        data.token,
      );
      if (!consumed) {
        throw new BadRequestException('Invalid or expired token');
      }

      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });

      // AUTH-1: старі сесії (включно з можливо-скомпрометованою) мертві — без
      // окремої user.sessions_revoked (spec FR-021): нижче власна активність
      const revokedCount = await this.sessions.revokeAllForUser(tx, user.id, 'password_reset');

      await this.activities.record(tx, {
        type: 'user.password_changed',
        // Актор — сам юзер: він довів володіння поштою токеном, це його дія
        actor: { type: 'user', id: user.id, label: user.name ?? user.email },
        payload: { user: { kind: 'user', id: user.id, label: user.name ?? user.email } },
        links: [{ entityType: 'user', entityId: user.id, role: 'subject' }],
      });

      this.logger.log(
        `Password reset for ${user.email} (ID: ${user.id}); revoked ${String(revokedCount)} session(s)`,
      );

      this.tenantTx.onCommit(tx, () => {
        this.realtime.disconnectUser(user.id);
      });
    });

    // Нова пара — ПІСЛЯ коміту (той самий прийом, що AccountService.changePassword):
    // створена всередині транзакції, вона потрапила б під revokeAllForUser вище
    const tokens = await this.auth.issueTokens(user, client);
    return { user, tokens };
  }
}
