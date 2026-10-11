import { DemoLoginCta } from '../components/demo-login-cta';
import { PublicGuideShell } from '../components/public-guide-shell';
import { GuideContent } from './guide-content';

/**
 * Публічний путівник (`/about`): той самий `GuideContent`, що в `/guide`, у спрощеній
 * статичній копії шела (`PublicGuideShell`) і без гейта авторизації — гість читає, що
 * це за система, ще до входу.
 * Статуси модулів (`done` / `partial` / `designed` / `planned`) і теги аудиторій
 * показуються гостю як є — рішення власника від 2026-10-11 (docs/demo.md,
 * «Публічний путівник»); окремого публічного набору даних немає.
 */
export function AboutPage() {
  return (
    <PublicGuideShell>
      <GuideContent />
      {/* Кнопка входу після останнього параграфа — частина публічної сторінки, не вмісту */}
      <DemoLoginCta />
    </PublicGuideShell>
  );
}
