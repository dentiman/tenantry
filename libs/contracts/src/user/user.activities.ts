import { z } from 'zod';
import { EntityRefSchema, defineActivityTypes } from '../activity/activity-definition';

/**
 * Типи активності юзерів. Зміна пароля і вмикання/вимикання — три ОКРЕМІ типи, а не один
 * `user.updated` із діффом: журнал читають люди, і «хто вимкнув доступ» мусить фільтруватися
 * одним type, не розбором payload-у. Пароль у payload не потрапляє НІКОЛИ — ні новий, ні
 * хеш, ні його довжина.
 *
 * `user.sessions_revoked` — self-service «вийти на всіх пристроях». Окремий тип, а не
 * `user.password_changed`: відкликання сесій буває і без зміни пароля, і читач журналу має
 * бачити різницю. `user.email_changed` (AUTH-3) — свідома дія над ідентичністю акаунта:
 * журнал показує стару і нову адресу разом.
 *
 * Тексти — платформні, у спільному неймспейсі `activities`.
 */
export const USER_ACTIVITIES = defineActivityTypes(
  { ns: 'activities' },
  {
    'user.created': {
      workspace: true,
      payload: z.object({
        user: EntityRefSchema, // kind: 'user'
      }),
    },
    'user.password_changed': {
      payload: z.object({
        user: EntityRefSchema,
      }),
    },
    'user.sessions_revoked': {
      payload: z.object({
        user: EntityRefSchema,
        // Скільки сесій вибито. Число, а не список пристроїв: журнал читають місяцями
        // потому, коли підписів тих сесій уже може не бути — а «скільки» лишається правдою
        sessionCount: z.number().int().nonnegative(),
        /**
         * AUTH-1. Пишеться ЛИШЕ для трьох причин (spec FR-021): `user` (revoke одного
         * рядка в списку пристроїв), `revoke_all` («вийти звідусіль») і `rotation_reuse`
         * (система сама вибила сесію, помітивши повторно використаний токен).
         *
         * Зміна пароля, скидання пароля, деактивація і скидання 2FA сесії теж
         * відкликають, але власної `sessions_revoked` НЕ пишуть — у них є своя
         * активність, а два рядки на одну дію зробили б фід нечитабельним.
         */
        reason: z.string().optional(),
      }),
      // AUTH-1: «відкликано сесії» читається по-різному залежно від того, ЧОМУ це сталося:
      // один пристрій, усі пристрої чи система сама вбила підозрілу сесію
      textVariant: (payload) =>
        typeof payload.reason === 'string' && payload.reason !== ''
          ? `user.sessions_revoked_${payload.reason}`
          : undefined,
    },
    'user.enabled': {
      workspace: true,
      payload: z.object({
        user: EntityRefSchema,
      }),
    },
    'user.disabled': {
      workspace: true,
      payload: z.object({
        user: EntityRefSchema,
      }),
    },
    'user.email_changed': {
      payload: z.object({
        user: EntityRefSchema,
        from: z.email(),
        to: z.email(),
      }),
    },
  },
);
