/**
 * Помилка, яку НЕ має сенсу ретраїти: невалідний конверт, невідома версія
 * повідомлення, порушене бізнес-правило («інвойс уже скасовано»). Runner віддає такий
 * job у DLQ негайно, не спалюючи retry-ліміт.
 *
 * Усе інше (БД/SMTP/мережа недоступні, гонка «сутність ще не з'явилася») лишається
 * звичайною помилкою і ретраїться з backoff — таблиця в
 * docs/event-driven-architecture.md §3.7.
 */
export class NonRetryableMessageError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'NonRetryableMessageError';
  }
}
