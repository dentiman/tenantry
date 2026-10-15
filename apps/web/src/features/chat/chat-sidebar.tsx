import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger } from '@saas-skeleton/ui/components/ui/tabs';
import { ConversationList } from './components/conversation-list';
import { InboxList } from './components/inbox-list';

type SidebarTab = 'customers' | 'internal';

/**
 * Друга колонка area «Chat» — список розмов.
 *
 * Вона НЕ є меню, і саме через неї контракт `Area.panel` — компонент, а не
 * масив пунктів (`chat.nav.ts`): тут живуть пошук, непрочитані й нескінченний
 * курсорний фід. Якби контракт був «пункти меню», чат не влазив би вже сюди.
 *
 * Дві вкладки: скринька клієнтів (спільна для тенанта; відкривається першою — клієнтська робота є
 * головною) і внутрішні розмови (участь). Це різні списки з різними правилами доступу, тому не
 * змішуються в одному фіді.
 */
export function ChatSidebar() {
  const { t } = useTranslation('chat');
  const [tab, setTab] = useState<SidebarTab>('customers');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs
        value={tab}
        onValueChange={(next) => {
          setTab(next as SidebarTab);
        }}
        // Без відступів: таби займають усю ширину колонки й торкаються її країв; нижня риска — межа блока
        className="shrink-0 gap-0 border-b border-sidebar-border"
      >
        {/* Мінімалістичні таби (variant="line"): без жолоба, заокруглень і поверхні сегмента — лише підпис і
            лінія-індикатор активного. Геометрія тригера підлаштована під нульові відступи списку: індикатор
            лягає поверх нижньої межі, а не на 5px нижче, куди його ставить стоковий `p-[3px]` */}
        <TabsList variant="line" className="w-full gap-0 rounded-none p-0">
          {(['customers', 'internal'] as const).map((value) => (
            <TabsTrigger
              key={value}
              value={value}
              className="h-full rounded-none group-data-horizontal/tabs:after:-bottom-px"
            >
              {t(`sidebar.tabs.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="min-h-0 flex-1">
        {tab === 'customers' ? <InboxList /> : <ConversationList />}
      </div>
    </div>
  );
}
