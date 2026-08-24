import type { ReactNode } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@saas-skeleton/ui/components/ui/avatar';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@saas-skeleton/ui/components/ui/item';

interface UserIdentityProps {
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
  /** Розміри реєстру: sm 24px, default 32px (стандарт рядка таблиці), lg 40px */
  size?: 'sm' | 'default' | 'lg';
  /** Оверлей аватара (напр. індикатор присутності) — рендериться ВСЕРЕДИНІ Avatar, бо AvatarBadge бере від нього розмір */
  badge?: ReactNode;
  /** Класи кореня (відступи/ширина від споживача) */
  className?: string;
  /** Класи текстового блоку — escape hatch для респонсивності: `hidden sm:flex` ховає підписи, лишаючи аватар */
  textClassName?: string;
}

/**
 * Ініціали для fallback-у: «Ada Lovelace» → «AL», «Ada» → «AD», без імені — з email.
 * Береться саме перша літера ДВОХ слів, а не перші дві літери рядка — так блок
 * читається як особа навіть коли аватара немає.
 */
function getInitials(name: string | null | undefined, email: string): string {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  const [first, second] = words;
  if (first && second) {
    return (first.charAt(0) + second.charAt(0)).toUpperCase();
  }
  return (first ?? email).slice(0, 2).toUpperCase();
}

/**
 * Ідентичність користувача одним блоком: аватар зліва, два рядки тексту справа.
 * Побудований на `Item` реєстру — від нього приходять розкладка, типографіка і
 * обрізання довгих рядків (`line-clamp`), тож власної верстки медіа-обʼєкта тут немає
 * (UI-1, костиль 7 у docs/migrate-web.md §3.2). Три класи-перевизначення свідомі:
 * `Item` розрахований на список (власні відступи і повна ширина), а тут він живе в
 * клітинці таблиці й у тригері дропдауна.
 *
 * Рішення, які лишились від попередньої версії:
 * - Без імені email піднімається в перший рядок, а другий НЕ рендериться взагалі
 *   (порожній рядок або «—» під аватаром збивав би вертикальний ритм списку).
 * - `title` на обох рядках: обрізаний текст мусить лишатись читабельним наведенням.
 * - Аватар декоративний (`alt=""`) — ім'я вже поруч текстом, інакше скрінрідер
 *   зачитує ідентичність двічі.
 */
export function UserIdentity({
  email,
  name,
  avatarUrl,
  size = 'default',
  badge,
  className,
  textClassName,
}: UserIdentityProps) {
  const displayName = name?.trim() ? name.trim() : null;
  const primary = displayName ?? email;
  const secondary = displayName ? email : null;

  return (
    // flex-nowrap: стоковий Item переносить вміст, і у вузькому контейнері
    // (згорнутий сайдбар) текст падав би під аватар замість того, щоб обрізатись
    <Item
      size="sm"
      className={['w-auto flex-nowrap gap-3 p-0', className].filter(Boolean).join(' ')}
    >
      {/* Аватар по центру блоку: стоковий ItemMedia притискає медіа до верху і зсуває
          на 2px, бо розрахований на багаторядковий опис — тут рядків рівно два */}
      <ItemMedia className="translate-y-0 self-center">
        <Avatar size={size}>
          {avatarUrl && <AvatarImage alt="" src={avatarUrl} />}
          <AvatarFallback>{getInitials(name, email)}</AvatarFallback>
          {badge}
        </Avatar>
      </ItemMedia>
      <ItemContent className={['min-w-0 gap-0', textClassName].filter(Boolean).join(' ')}>
        {/* leading-tight на обох рядках: стокові snug/normal лишають між іменем і
            поштою повітря, якого в рядку таблиці бути не має */}
        <ItemTitle className="leading-tight" title={primary}>
          {primary}
        </ItemTitle>
        {secondary && (
          <ItemDescription className="text-xs leading-tight" title={secondary}>
            {secondary}
          </ItemDescription>
        )}
      </ItemContent>
    </Item>
  );
}
