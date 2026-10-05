import { defineSlot } from '../lib/slots';

/** Кнопки праворуч у хедері — між перемикачем теми і тригером контекстної панелі */
export const shellHeaderActions = defineSlot('app.header-actions');

/**
 * Колонки праворуч від контекстної панелі: йдуть від верху вікна до низу, сусіди
 * `ContextPanelSlot`. Внесок сам вирішує, чи він зараз відкритий (повертає `null`, якщо ні)
 */
export const shellSidePanels = defineSlot('app.side-panels');
