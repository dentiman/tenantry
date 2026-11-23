import { Injectable } from '@nestjs/common';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';

/**
 * Охоронець сутності: відповідає, які саме екземпляри сутності певного типу (`calendar_event`)
 * бачить глядач. Записи журналу, що мають лінк на недоступний екземпляр, зі стрічки зникають.
 */
export interface ActivityEntityGuard {
  /**
   * Підмножина `candidateIds`, яку глядач може бачити. Id, якого немає у відповіді, — прихований:
   * і чужий, і той, що вже не існує (видалена сутність більше не вміє сказати, хто її бачив, тож
   * її записи не показуємо нікому).
   */
  visibleIds(viewer: JwtPayload, candidateIds: readonly string[]): Promise<ReadonlySet<string>>;
}

/**
 * Реєстр доступу до записів стрічки (docs/modules.md §4.2, docs/activity-log.md «Хто що бачить
 * у стрічці сутності»). `activities` — рівень нижче доменів, тож не знає, що подія календаря
 * буває приватною: модуль-власник сутності реєструє свого охоронця зі свого `onModuleInit`, а
 * вирішує він тією самою функцією доступу, що й для читання власних списків.
 */
@Injectable()
export class ActivityAccessRegistry {
  private readonly guards = new Map<string, ActivityEntityGuard>();

  guard(entityType: string, guard: ActivityEntityGuard): void {
    if (this.guards.has(entityType)) {
      throw new Error(`Activity entity guard for "${entityType}" is already registered`);
    }
    this.guards.set(entityType, guard);
  }

  all(): ReadonlyMap<string, ActivityEntityGuard> {
    return this.guards;
  }
}
