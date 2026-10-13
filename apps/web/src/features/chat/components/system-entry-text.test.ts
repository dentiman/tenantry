import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import chat from '../../../locales/en/chat.json';
import { systemEntryText } from './chat-labels';
import type { ChatMessage } from './use-chat';

const i18n = i18next.createInstance();
await i18n.init({ resources: { en: { chat } }, lng: 'en', defaultNS: 'chat', interpolation: { escapeValue: false } });
const t = i18n.getFixedT('en', 'chat');

function entry(payload: Record<string, unknown>, senderLabel: string | null = 'Alice'): ChatMessage {
  return { kind: 'SYSTEM', payload, senderLabel } as unknown as ChatMessage;
}

describe('systemEntryText: робочий процес клієнтської розмови (CHAT-2b)', () => {
  it('призначення називає виконавця й нового відповідального', () => {
    expect(
      systemEntryText(entry({ type: 'conversation.assigned', assignee: { id: 'u', label: 'Bob' } }), t),
    ).toBe('Alice assigned the conversation to Bob');
  });

  it('зняття призначення — окрема фраза', () => {
    expect(systemEntryText(entry({ type: 'conversation.assigned', assignee: null }), t)).toBe(
      'Alice removed the assignee',
    );
  });

  it('зміна статусу називає новий статус словом, а не кодом', () => {
    expect(
      systemEntryText(entry({ type: 'conversation.status_changed', from: 'OPEN', to: 'RESOLVED' }), t),
    ).toBe('Alice set the status to Resolved');
  });

  it('зміну від вхідного повідомлення підписано клієнтом, а невідомий тип дає порожній рядок', () => {
    expect(
      systemEntryText(
        entry({ type: 'conversation.status_changed', from: 'PENDING', to: 'OPEN' }, 'Олена'),
        t,
      ),
    ).toBe('Олена set the status to Open');
    expect(systemEntryText(entry({ type: 'something.new' }), t)).toBe('');
  });
});
