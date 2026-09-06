import { MessagesSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';

/**
 * Індексна сторінка area «Chat»: тут відкриється вибрана розмова.
 *
 * Порожній стан, а не «сторінка в розробці»: коли зʼявиться `/chat/$conversationId`,
 * цей екран лишиться саме тим, що видно, доки розмову не вибрали.
 */
export function ChatPage() {
  const { t } = useTranslation('chat');

  return (
    <>
      <PageBreadcrumbs items={[{ label: t('title') }]} />
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessagesSquare />
          </EmptyMedia>
          <EmptyTitle>{t('page.empty.title')}</EmptyTitle>
          <EmptyDescription>{t('page.empty.description')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </>
  );
}
