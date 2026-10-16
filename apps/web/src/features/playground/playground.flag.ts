/**
 * Вимикач Playground — змінна збірки `VITE_PLAYGROUND=true` (будь-що інше або її відсутність —
 * вимкнено). Стенди потрібні лише в локальній розробці, тож на стендах і в проді розділу немає:
 * ні пункту в рейлі, ні маршрутів (`/playground/*` редіректить на `/`). Vite бере `VITE_*` з
 * оточення процесу або з `apps/web/.env.local`, не з кореневого `.env`.
 */
export const PLAYGROUND_ENABLED = import.meta.env.VITE_PLAYGROUND === 'true';
