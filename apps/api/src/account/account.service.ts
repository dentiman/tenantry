import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService, TenantTransactions } from '@saas-skeleton/database';
import { ActivityRecorder } from '@saas-skeleton/shared';
import type { AuthTokens, ChangeOwnPassword, UpdateAccountProfile } from '@saas-skeleton/contracts';
import * as argon2 from 'argon2';
import { AuthService } from '../auth/auth.service';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { UsersService, type UserWithAvatar } from '../users/users.service';

/**
 * Self-service «мій акаунт». Свідомо окремий модуль від `users`, хоча таблиця та сама:
 * там адмін керує ІНШИМИ (`/users/:id`), тут людина керує СОБОЮ. Різниця не косметична —
 * у цього модуля немає id у шляху взагалі, суб'єкт завжди `@CurrentUser().sub`, тому
 * відредагувати чужий акаунт цими роутами неможливо навіть помилкою в коді.
 *
 * Доменну роботу не дублюємо: профіль і пароль виконує UsersService (там уже живуть
 * нормалізація телефону, валідація аватара, відкликання сесій, журнал і сповіщення).
 * Тут — тільки те, чого в адмінському флоу немає: доказ володіння поточним паролем
 * і повернення свіжої пари токенів собі.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly tenantTx: TenantTransactions,
    private readonly activities: ActivityRecorder,
  ) {}

  findMe(userId: string): Promise<UserWithAvatar> {
    return this.users.findOne(userId);
  }

  updateProfile(userId: string, data: UpdateAccountProfile): Promise<UserWithAvatar> {
    this.logger.log(`Updating own profile: ${userId}`);
    // UpdateAccountProfile — підмножина UpdateUser, тому додаткового мапінгу немає:
    // поля, яких тут бракує (role, isActive, email), просто не приїжджають у патч
    return this.users.update(userId, data);
  }

  /**
   * Зміна власного пароля. Повертає НОВУ пару токенів: `UsersService.setPassword`
   * відкликає ВСІ refresh-сесії юзера (включно з тією, з якої прийшов запит) —
   * без свіжої пари людина вилітала б на /login за власну ж дію.
   */
  async changePassword(
    userId: string,
    data: ChangeOwnPassword,
    actor: JwtPayload,
  ): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) {
      // Юзер із JWT, але без хеша — акаунт без пароля (майбутній SSO): міняти нічого
      this.logger.warn(`Password change refused - no password set: ${userId}`);
      throw new UnauthorizedException('Password change is not available for this account');
    }

    if (!(await argon2.verify(user.passwordHash, data.currentPassword))) {
      this.logger.warn(`Password change refused - wrong current password: ${user.email}`);
      // 400 з полем, а не 401: сесія валідна, помилилися саме в полі форми —
      // фронт покаже текст під ним (applyServerError), а не викине на /login
      throw new BadRequestException({
        message: 'Current password is incorrect',
        fieldErrors: [
          {
            field: 'currentPassword',
            message: 'Current password is incorrect',
            code: 'invalid_current_password',
          },
        ],
      });
    }

    await this.users.setPassword(userId, data.newPassword, actor);

    return this.auth.issueTokens(user);
  }

  /**
   * «Вийти на всіх пристроях». Сесії як сутності в моделі немає (рядок refresh-токена
   * живе до найближчої ротації і щоразу отримує новий id), тому вибірковий revoke
   * неможливий за визначенням — тільки все або нічого.
   *
   * Гарантія не миттєва: вже виданий access-токен stateless і догорає до 15 хвилин.
   * Це свідома межа V1 — денилист у Valkey не заводимо.
   */
  async revokeAllSessions(userId: string, actor: JwtPayload): Promise<AuthTokens> {
    const user = await this.users.findOne(userId);

    await this.tenantTx.withTenantTx(async (tx) => {
      const revoked = await tx.refreshToken.deleteMany({ where: { userId } });

      await this.activities.record(tx, {
        type: 'user.sessions_revoked',
        actor: { type: 'user', id: actor.sub, label: actor.email },
        payload: {
          user: { kind: 'user', id: user.id, label: user.name ?? user.email },
          sessionCount: revoked.count,
        },
        links: [{ entityType: 'user', entityId: user.id, role: 'subject' }],
      });

      this.logger.log(
        `Revoked ${String(revoked.count)} refresh session(s) for ${user.email} (ID: ${userId})`,
      );
    });

    // Нова пара — ПІСЛЯ коміту: створена всередині транзакції, вона потрапила б
    // під той самий deleteMany і юзер вибив би сам себе
    return this.auth.issueTokens(user);
  }
}
