import { Fragment, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@saas-skeleton/ui/components/ui/breadcrumb';
import { PageHeaderPortal } from '@saas-skeleton/ui/components/page-header-slot';

export interface Crumb {
  label: ReactNode;
  /** Без `to` — це поточна сторінка (останній елемент, не посилання) */
  to?: string;
  params?: Record<string, string>;
}

/**
 * Хлібні крихти сторінки, які показуються В ХЕДЕРІ layout-а.
 *
 * Сторінка рендерить цей компонент у себе, а `PageHeaderPortal` телепортує розмітку
 * в слот хедера. `Link` тут працює як звичайний лінк роутера, хоча в DOM він опиниться
 * поза `<main>`: портал міняє місце в DOM, але дерево React (і всі його контексти)
 * лишається тим самим — деталі в `libs/ui/src/components/page-header-slot.tsx`.
 */
export function PageBreadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <PageHeaderPortal>
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
    </PageHeaderPortal>
  );
}
