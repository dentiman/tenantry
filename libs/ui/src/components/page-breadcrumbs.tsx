import { Fragment, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './ui/breadcrumb';
import { PageHeaderPortal } from './page-header-slot';

export interface Crumb {
  label: ReactNode;
  /** Без `to` — це поточна сторінка (останній елемент, не посилання) */
  to?: string;
  params?: Record<string, string>;
}

/**
 * Розмітка крихт БЕЗ порталу — щоб її можна було покласти в довільне місце
 * хедера (`PageHeader` кладе її в ліву зону поруч із підзаголовком і діями).
 *
 * `Link` тут працює як звичайний лінк роутера, хоча в DOM опиниться поза
 * `<main>`: портал міняє місце в DOM, але дерево React (і всі його контексти)
 * лишається тим самим — деталі в `./page-header-slot.tsx`.
 */
export function CrumbTrail({ items }: { items: Crumb[] }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, index) => (
          <Fragment key={index}>
            {index > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {item.to ? (
                // BreadcrumbLink і так рендерить <a>, тож nativeButton тут не потрібен
                // (на відміну від Button, який без нього лишає семантику кнопки)
                <BreadcrumbLink render={<Link to={item.to} params={item.params} />}>
                  {item.label}
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage className="truncate">{item.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/**
 * Хлібні крихти сторінки, які показуються В ХЕДЕРІ layout-а.
 *
 * Найпростіша форма наповнення хедера — тільки крихти й нічого більше. Коли
 * сторінці потрібні ще дії або підзаголовок, береться `PageHeader`: обидва
 * компоненти займають ОДИН слот, тому на екрані має бути рівно один із них.
 */
export function PageBreadcrumbs({ items, label }: { items: Crumb[]; label?: string }) {
  return (
    <PageHeaderPortal label={label ?? 'PageBreadcrumbs'}>
      <CrumbTrail items={items} />
    </PageHeaderPortal>
  );
}
