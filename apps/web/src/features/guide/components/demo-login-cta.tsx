import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { ArrowRightIcon, LogInIcon } from 'lucide-react';
import { buttonVariants } from '@saas-skeleton/ui/components/ui/button';
import { cn } from '@saas-skeleton/ui/lib/utils';
import { useAuthStore } from '../../auth/stores/auth.store';

/**
 * Велика кнопка після останнього параграфа публічного путівника: «Login to CRM Demo».
 *
 * Це частина ПУБЛІЧНОЇ сторінки (`AboutPage` кладе її після `GuideContent`), а не самого
 * путівника: вміст спільний із `/guide`, і кнопка не має там з'являтись — тож у
 * `GuideContent` для неї нічого не передбачено (ні пропа, ні перевірки роуту).
 *
 * Залежить від сесії, як кнопка в нижній смузі колонки: гостю «Login to CRM Demo» → `/login`,
 * залогіненому «Open the CRM demo» → `/workspace`. Це звичайне посилання, а не вхід в один
 * клік: `/login` і так відкривається з уже підставленим флагманським демо-акаунтом, тож до
 * входу лишається один натиск «Sign in», а прямий вхід звідси зв'язав би путівник із
 * формою входу, її мутацією й збірковим вимикачем `VITE_DEMO_LOGINS`.
 *
 * Розмір — `xl` самого примітива (48px; правило UI-стека: розмір контролів задає примітив, а не
 * `h-*` на місці виклику). Піл (`radius="full"`) і тінь кольору бренду — для вигляду заклику.
 */
export function DemoLoginCta() {
  const { t } = useTranslation('guide');
  const user = useAuthStore((state) => state.user);
  const label = user ? t('about.demoOpen') : t('about.demoLogin');
  const Icon = user ? ArrowRightIcon : LogInIcon;
  const className = cn(
    buttonVariants({ size: 'xl', radius: 'full' }),
    'shadow-lg shadow-primary/25',
  );
  const content = (
    <>
      <Icon data-icon="inline-start" />
      {label}
    </>
  );

  return (
    <div className="mx-auto flex max-w-6xl justify-center pt-4 pb-16">
      {user ? (
        <Link to="/workspace" className={className}>
          {content}
        </Link>
      ) : (
        <Link to="/login" className={className}>
          {content}
        </Link>
      )}
    </div>
  );
}
