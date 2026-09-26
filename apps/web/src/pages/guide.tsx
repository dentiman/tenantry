import { useTranslation } from 'react-i18next';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';

/**
 * Стенд «Architecture diagram» — той самий self-contained HTML, який Archify
 * генерує для показу архітектури (frontend/backend/message queue/Postgres/
 * realtime/інфраструктура), вбудований прямо в tenant-портал для презентацій.
 *
 * Файл лежить у `public/diagrams/architecture.html` і рендериться `<iframe>`,
 * а не інлайновиться в бандл: діаграма — самодостатня сторінка (свій `<html>`,
 * стилі, тема, зум/пан, експорт), і `iframe` — єдиний спосіб показати чужий
 * document без конфлікту стилів/скриптів із застосунком. Оновлення діаграми —
 * заміна файлу, без правок коду сторінки.
 *
 * `bleed`-розкладка (staticData роуту) і висота за зразком `calendar.tsx`:
 * `h-[calc(100vh-3.5rem)]` компенсує `h-14` хедера шела, бо сторінка-полотно
 * сама керує своєю вертикаллю, а не шел.
 */
export function PlaygroundArchitecturePage() {
  const { t } = useTranslation('playground');

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-[28rem] flex-col">
      <PageHeader label="PlaygroundArchitecturePage" breadcrumbs={[{ label: t('architecture.title') }]} />
      <iframe
        src="/diagrams/architecture.html"
        title={t('architecture.frameTitle')}
        className="h-full w-full flex-1 border-0"
      />
    </div>
  );
}
