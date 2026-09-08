import type { ReactNode } from 'react';

/**
 * Секція сторінки налаштувань — тепер лише метрика розділу.
 *
 * Заголовок і опис звідси знято 2026-09-08: вони дублювали крихти в хедері
 * («Settings › General» угорі й «General» першим рядком контенту — та сама
 * дуплікація, що прибрана зі списків). Тепер назва і пояснення живуть у
 * `PageHeader`, а контент починається одразу з форми. Разом із заголовком пішла
 * й лінійка `Separator`: вона відділяла його від вмісту, а відділяти більше
 * нічого.
 *
 * Компонент лишається, хоч і звівся до ширин: метрика розділу описана в одному
 * місці, а не розповзлась по девʼятьох сторінках налаштувань. Форма шаблону —
 * satnaing/shadcn-admin (`content-section.tsx`).
 */
export function ContentSection({ children }: { children: ReactNode }) {
  return (
    <section className="flex w-full max-w-2xl flex-col">
      <div className="-mx-1 flex-1 px-1 py-1 lg:max-w-xl">{children}</div>
    </section>
  );
}
