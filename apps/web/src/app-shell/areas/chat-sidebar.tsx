import { ConversationList } from '../../components/chat/conversation-list';

/**
 * Друга колонка area «Chat» — список розмов.
 *
 * Вона НЕ є меню, і саме через неї контракт `AppArea.Sidebar` — компонент, а не
 * масив пунктів (`areas.tsx`): тут живуть пошук, непрочитані й нескінченний
 * курсорний фід. Якби контракт був «пункти меню», чат не влазив би вже сюди.
 */
export function ChatSidebar() {
  return <ConversationList />;
}
