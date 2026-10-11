import { describe, expect, it } from 'vitest';
import { GUIDE_SECTIONS, guideSectionFromHash } from './guide.content';

describe('guideSectionFromHash', () => {
  it('знаходить параграф і з `#`, і без нього', () => {
    expect(guideSectionFromHash('#architecture')).toBe('architecture');
    expect(guideSectionFromHash('architecture')).toBe('architecture');
  });

  it('знає кожен параграф путівника', () => {
    for (const section of GUIDE_SECTIONS) {
      expect(guideSectionFromHash(`#${section.id}`)).toBe(section.id);
    }
  });

  it('порожній або чужий якір не обирає нічого', () => {
    expect(guideSectionFromHash('')).toBeNull();
    expect(guideSectionFromHash('#')).toBeNull();
    expect(guideSectionFromHash('#nope')).toBeNull();
    // Регістр значущий: `id` секції в DOM теж чутливий до нього
    expect(guideSectionFromHash('#Architecture')).toBeNull();
  });
});
