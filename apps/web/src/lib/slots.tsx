import { createContext, useContext, useMemo, type ComponentType, type ReactNode } from 'react';

/**
 * Слоти — звʼязок угору по графу модулів без імпорту (docs/modules.md §4).
 *
 * Сторінка клієнта показує події календаря, дашборд — агенду, оболонка — AI-панель. Але
 * `customers`, `dashboard` і `app` лежать нижче за фічі, і прямий імпорт фічі зробив би
 * граф циклічним. Тому слот оголошує модуль, який його РЕНДЕРИТЬ (`defineSlot` у його ж
 * файлі), фіча експортує компонент, а повʼязує їх лише composition root
 * (`slot-fills.ts`). Видалив фічу — прибрав рядок там, слот просто порожніє.
 */

declare const SLOT_PROPS: unique symbol;

export interface Slot<P extends object> {
  readonly name: string;
  /** Лише для виведення типу пропсів — у рантаймі поля немає */
  readonly [SLOT_PROPS]?: P;
}

export interface SlotFill {
  readonly slot: string;
  /** Ключ React і місце в повідомленнях про помилки */
  readonly id: string;
  readonly component: ComponentType<never>;
}

export function defineSlot<P extends object = Record<never, never>>(name: string): Slot<P> {
  return { name };
}

export function fillSlot<P extends object>(
  slot: Slot<P>,
  id: string,
  component: ComponentType<P>,
): SlotFill {
  // Стирання типу пропсів для зберігання: `ComponentClass.defaultProps` робить
  // ComponentType інваріантним за P. Відновлює його `useSlotFills` за тим самим слотом
  return { slot: slot.name, id, component: component as unknown as ComponentType<never> };
}

const SlotsContext = createContext<ReadonlyMap<string, readonly SlotFill[]>>(new Map());

export function SlotsProvider({
  fills,
  children,
}: {
  fills: readonly SlotFill[];
  children: ReactNode;
}) {
  const bySlot = useMemo(() => {
    const map = new Map<string, SlotFill[]>();
    for (const fill of fills) map.set(fill.slot, [...(map.get(fill.slot) ?? []), fill]);
    return map;
  }, [fills]);
  return <SlotsContext.Provider value={bySlot}>{children}</SlotsContext.Provider>;
}

/** Внески в слот у порядку з `slot-fills.ts`; порожній масив, якщо фічі немає */
export function useSlotFills<P extends object>(
  slot: Slot<P>,
): readonly { id: string; Component: ComponentType<P> }[] {
  const fills = useContext(SlotsContext).get(slot.name) ?? [];
  // `fillSlot` уже звірив тип пропсів зі слотом — тут лише повертаємо його назад
  return fills.map((fill) => ({
    id: fill.id,
    Component: fill.component as unknown as ComponentType<P>,
  }));
}

/** Рендерить усі внески слота поспіль з однаковими пропсами */
export function SlotOutlet<P extends object>({ slot, props }: { slot: Slot<P>; props: P }) {
  const fills = useSlotFills(slot);
  return (
    <>
      {fills.map(({ id, Component }) => (
        <Component key={id} {...props} />
      ))}
    </>
  );
}
