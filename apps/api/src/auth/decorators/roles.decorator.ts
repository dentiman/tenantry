import { SetMetadata } from '@nestjs/common';
import type { Role } from '@saas-skeleton/database';

export const ROLES_KEY = 'requiredRoles';

/**
 * Мінімальний рольовий гейт — зародок RBAC, а не він сам.
 *
 * Введений разом із налаштуваннями воркспейсу (docs/workspace-settings.md):
 * зсув нумерації чи зміна валюти компанії — дія з наслідками для всіх, і
 * лишати її будь-якому USER-у не можна. Повний RBAC (permissions-рядки
 * `settings:write` + `@RequirePermissions`) прийде окремою фазою і **замінить**
 * цей декоратор — саме тому він навмисно вузький: жодних ієрархій ролей,
 * жодного «власник ресурсу», тільки перелік дозволених ролей на хендлері.
 */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
