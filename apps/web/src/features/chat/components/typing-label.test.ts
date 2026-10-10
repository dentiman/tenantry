import { describe, expect, it } from 'vitest';
import { describeTypists } from './typing-label';

const participants = [
  { id: 'alice', name: 'Alice', email: 'alice@example.com' },
  { id: 'bob', name: null, email: 'bob@example.com' },
  { id: 'carol', name: 'Carol', email: 'carol@example.com' },
  { id: 'dave', name: 'Dave', email: 'dave@example.com' },
];

/** Підпис не нанизує по рядку на людину: одне імʼя, два імені, далі лічильник */
describe('describeTypists', () => {
  it('says nothing when nobody is typing', () => {
    expect(describeTypists([], participants)).toBeNull();
  });

  it('names a single typist, falling back to the email without a name', () => {
    expect(describeTypists(['alice'], participants)).toEqual({
      key: 'typing.one',
      values: { name: 'Alice' },
    });
    expect(describeTypists(['bob'], participants)).toEqual({
      key: 'typing.one',
      values: { name: 'bob@example.com' },
    });
  });

  it('names two typists in one line', () => {
    expect(describeTypists(['alice', 'carol'], participants)).toEqual({
      key: 'typing.two',
      values: { first: 'Alice', second: 'Carol' },
    });
  });

  it('summarises three or more as a count', () => {
    expect(describeTypists(['alice', 'carol', 'dave'], participants)).toEqual({
      key: 'typing.many',
      values: { count: 3 },
    });
  });

  it('skips a typist the conversation card does not know yet', () => {
    expect(describeTypists(['stranger'], participants)).toBeNull();
    expect(describeTypists(['stranger', 'alice'], participants)).toEqual({
      key: 'typing.one',
      values: { name: 'Alice' },
    });
  });
});
