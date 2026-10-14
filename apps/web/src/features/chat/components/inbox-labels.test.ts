import { describe, expect, it } from 'vitest';
import { conversationLabel } from './chat-labels';
import { inboxTitle, type InboxEntry } from './use-inbox';
import type { Conversation } from './use-chat';

// Підписи клієнтських розмов (CHAT-2a): що людина бачить у списку й заголовку.

type T = Parameters<typeof conversationLabel>[2];
const t = ((key: string) => key) as unknown as T;

const entry = (
  displayName: string | null,
  customerName: string | null,
): Pick<InboxEntry, 'contact'> => ({
  contact: {
    id: 'c1',
    displayName,
    customer: customerName ? { id: 'k1', name: customerName } : null,
  },
});

describe('inboxTitle', () => {
  it('профільне імʼя має перевагу над привʼязаним клієнтом', () => {
    expect(inboxTitle(entry('Олена', 'ТОВ Ромашка'))).toBe('Олена');
  });

  it('без імені береться привʼязаний клієнт', () => {
    expect(inboxTitle(entry(null, 'ТОВ Ромашка'))).toBe('ТОВ Ромашка');
  });

  it('без обох — null: рендерер сам підставить «невідомий контакт»', () => {
    expect(inboxTitle(entry(null, null))).toBeNull();
  });
});

describe('conversationLabel для клієнтської розмови', () => {
  const base = { title: null, participants: [] } as unknown as Conversation;

  it('показує людину по той бік каналу, а не «Just you»', () => {
    const conversation = {
      ...base,
      contact: {
        id: 'c',
        displayName: 'Олена',
        channelNumber: '+1 555',
        deliveryReceipts: true,
        templates: true,
      },
    } as Conversation;
    expect(conversationLabel(conversation, 'viewer', t)).toBe('Олена');
  });

  it('без імені — номер каналу, без нього — «невідомий контакт»', () => {
    expect(
      conversationLabel(
        {
          ...base,
          contact: {
            id: 'c',
            displayName: null,
            channelNumber: '+1 555',
            deliveryReceipts: true,
            templates: true,
          },
        },
        'v',
        t,
      ),
    ).toBe('+1 555');
    expect(
      conversationLabel(
        {
          ...base,
          contact: {
            id: 'c',
            displayName: null,
            channelNumber: null,
            deliveryReceipts: true,
            templates: true,
          },
        },
        'v',
        t,
      ),
    ).toBe('inbox.unknownContact');
  });

  it('внутрішня розмова не змінилась: порожній склад — «Just you»', () => {
    expect(conversationLabel({ ...base, contact: null }, 'v', t)).toBe('conversation.justYou');
  });
});
