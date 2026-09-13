import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService, TenantTransactions } from '@saas-skeleton/database';
import { ActivityRecorder } from '@saas-skeleton/shared';
import type {
  AuthSessionResponse,
  AuthTokens,
  ChangeOwnPassword,
  UpdateAccountProfile,
} from '@saas-skeleton/contracts';
import * as argon2 from 'argon2';
import { AuthService } from '../auth/auth.service';
import { AuthSessionService } from '../auth/auth-session.service';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import type { ClientContextData } from '../common/client-context.decorator';
import { RealtimeEmitter } from '../realtime/realtime.emitter';
import { UsersService, type UserWithAvatar } from '../users/users.service';
import { toAuthSessionResponse } from './account.mapper';

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
    private readonly sessions: AuthSessionService,
    private readonly realtime: RealtimeEmitter,
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
    client: ClientContextData,
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

    return this.auth.issueTokens(user, client);
  }

  /**
   * «Вийти на всіх пристроях». Лишається як була — все або нічого; вибірковий
   * revoke тепер теж можливий (`revokeSession`), але це інша дія і інша кнопка.
   *
   * Гарантія миттєва для realtime (socket-и рвуться) і відкладена для REST:
   * вже виданий access-токен stateless і догорає до 15 хвилин. Денилист у Valkey
   * свідомо не заводимо — межа чесно підписана в UI.
   */
  async revokeAllSessions(
    userId: string,
    actor: JwtPayload,
    client: ClientContextData,
  ): Promise<AuthTokens> {
    const user = await this.users.findOne(userId);

    await this.tenantTx.withTenantTx(async (tx) => {
      const count = await this.sessions.revokeAllForUser(tx, userId, 'revoke_all');

      await this.activities.record(tx, {
        type: 'user.sessions_revoked',
        actor: { type: 'user', id: actor.sub, label: actor.email },
        payload: {
          user: { kind: 'user', id: user.id, label: user.name ?? user.email },
          sessionCount: count,
          reason: 'revoke_all',
        },
        links: [{ entityType: 'user', entityId: user.id, role: 'subject' }],
      });

      this.logger.log(`Revoked ${String(count)} session(s) for ${user.email} (ID: ${userId})`);

      this.tenantTx.onCommit(tx, () => {
        this.realtime.disconnectUser(userId);
      });
    });

    // Нова пара — ПІСЛЯ коміту: створена всередині транзакції, вона потрапила б
    // під той самий revokeAllForUser і юзер вибив би сам себе
    return this.auth.issueTokens(user, client);
  }

  /** Список «моїх пристроїв»; поточний — першим, решта за свіжістю використання */
  async listSessions(userId: string, currentSid: string): Promise<AuthSessionResponse[]> {
    const sessions = await this.sessions.listForUser(userId);
    return sessions
      .map((session) => toAuthSessionResponse(session, currentSid))
      .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
  }

  /**
   * Завершити ОДИН пристрій. Чужа, неіснуюча і вже мертва сесія дають однаковий
   * 404, а не 403: різниця між ними — це оракул «а чи існує сесія з таким id»,
   * і платити ним за точність повідомлення нема за що.
   */
  async revokeSession(userId: string, sid: string, actor: JwtPayload): Promise<void> {
    const user = await this.users.findOne(userId);

    // RLS відсіює чужий тенант; `userId` — чужого юзера в межах свого тенанта
    const session = await this.sessions.findOwnLiveSession(userId, sid);
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    await this.tenantTx.withTenantTx(async (tx) => {
      const count = await this.sessions.revoke(tx, sid, 'user');

      await this.activities.record(tx, {
        type: 'user.sessions_revoked',
        actor: { type: 'user', id: actor.sub, label: actor.email },
        payload: {
          user: { kind: 'user', id: user.id, label: user.name ?? user.email },
          sessionCount: count,
          reason: 'user',
        },
        links: [{ entityType: 'user', entityId: user.id, role: 'subject' }],
      });

      // Рве socket САМЕ цього пристрою: інші вкладки юзера сидять у room-ах
      // своїх sid і лишаються підключеними
      this.tenantTx.onCommit(tx, () => {
        this.realtime.disconnectSession(sid);
      });
    });

    this.logger.log(`Session ${sid} revoked by its owner (user: ${userId})`);
  }
}
