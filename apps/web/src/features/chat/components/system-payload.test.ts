import { describe, expect, it } from 'vitest';
import { ChatSystemPayloadSchema } from '@saas-skeleton/contracts';

/**
 * Системний запис у стрічці — єдине місце, де бекенд і фронт домовляються не про
 * ТЕКСТ, а про `type` + параметри (docs/chat.md §4.7). Текст не зберігається, і
 * розійтися ці двоє можуть тільки тут — на формі payload-у.
 *
 * Тест саме round-trip: `parse` того, що реально лежить у колонці, і перевірка,
 * що дискримінант звузив тип до потрібної гілки.
 */
describe('ChatSystemPayloadSchema', () => {
  it('parses conversation.created as stored by the server', () => {
    const parsed = ChatSystemPayloadSchema.parse({ type: 'conversation.created' });

    expect(parsed.type).toBe('conversation.created');
  });

  it('parses member.added together with its member snapshot', () => {
    const stored = {
      type: 'member.added',
      member: { id: '9def6e59-cdbd-425e-a4f2-3ee505e5b452', label: 'Admin' },
    };

    const parsed = ChatSystemPayloadSchema.parse(stored);

    // Звуження по дискримінанту: без нього `member` не був би доступний
    expect(parsed.type === 'member.added' && parsed.member.label).toBe('Admin');
    expect(ChatSystemPayloadSchema.parse(parsed)).toEqual(stored);
  });

  it('rejects member.added without its member snapshot', () => {
    // Снапшот обовʼязковий: юзера можуть видалити, а рядок «X додав Y» мусить
    // лишитись читабельним без join-у на живу таблицю
    expect(() => ChatSystemPayloadSchema.parse({ type: 'member.added' })).toThrow();
  });

  it('rejects an unknown entry type', () => {
    expect(() => ChatSystemPayloadSchema.parse({ type: 'member.removed' })).toThrow();
  });
});
