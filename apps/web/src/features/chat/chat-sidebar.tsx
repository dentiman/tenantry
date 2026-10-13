import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger } from '@saas-skeleton/ui/components/ui/tabs';
import { ConversationList } from './components/conversation-list';
import { InboxList } from './components/inbox-list';

type SidebarTab = 'internal' | 'customers';

/**
 * Друга колонка area «Chat» — список розмов.
 *
 * Вона НЕ є меню, і саме через неї контракт `Area.panel` — компонент, а не
 * масив пунктів (`chat.nav.ts`): тут живуть пошук, непрочитані й нескінченний
 * курсорний фід. Якби контракт був «пункти меню», чат не влазив би вже сюди.
 *
 * CHAT-2a: дві вкладки — внутрішні розмови (участь) і скринька клієнтів (спільна для тенанта).
 * Це різні списки з різними правилами доступу, тому не змішуються в одному фіді.
 */
export function ChatSidebar() {
  const { t } = useTranslation('chat');
  const [tab, setTab] = useState<SidebarTab>('internal');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs
        value={tab}
        onValueChange={(next) => {
          setTab(next as SidebarTab);
        }}
        className="shrink-0 border-b border-sidebar-border p-2"
      >
        <TabsList className="w-full">
          <TabsTrigger value="internal">{t('sidebar.tabs.internal')}</TabsTrigger>
          <TabsTrigger value="customers">{t('sidebar.tabs.customers')}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="min-h-0 flex-1">
        {tab === 'internal' ? <ConversationList /> : <InboxList />}
      </div>
    </div>
  );
}
