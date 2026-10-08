import { ConversationList } from './components/conversation-list';

/**
 * Друга колонка area «Chat» — список розмов.
 *
 * Вона НЕ є меню, і саме через неї контракт `Area.panel` — компонент, а не
 * масив пунктів (`chat.nav.ts`): тут живуть пошук, непрочитані й нескінченний
 * курсорний фід. Якби контракт був «пункти меню», чат не влазив би вже сюди.
 */
export function ChatSidebar() {
  return <ConversationList />;
}
