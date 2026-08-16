import type { ReactNode } from 'react';
import { Avatar } from '@heroui/react';

interface UserIdentityProps {
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  /** Оверлей поверх аватара (PresenceDot тощо) — позиціонується абсолютно самим оверлеєм */
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
 * Ідентичність користувача одним блоком: аватар зліва, два рядки тексту справа
 * (патерн media object; у дизайн-системах — Persona / User / AvatarItem).
 *
 * Рішення:
 * - Без імені email піднімається в перший рядок, а другий НЕ рендериться взагалі
 *   (порожній рядок або «—» під аватаром збивав би вертикальний ритм списку).
 * - `min-w-0` на корені і на текстовій колонці — без нього flex-дитина має
 *   min-width:auto і `truncate` не спрацьовує ніколи (класична грабля).
 * - `title` на обох рядках: обрізаний текст мусить лишатись читабельним наведенням.
 * - Аватар декоративний (`alt=""`) — ім'я вже поруч текстом, інакше скрінрідер
 *   зачитує ідентичність двічі.
 */
export function UserIdentity({
  email,
  name,
  avatarUrl,
  size = 'sm',
  badge,
  className,
  textClassName,
}: UserIdentityProps) {
  const displayName = name?.trim() ? name.trim() : null;
  const primary = displayName ?? email;
  const secondary = displayName ? email : null;

  return (
    <div className={['flex min-w-0 items-center gap-3', className].filter(Boolean).join(' ')}>
      <span className="relative inline-flex shrink-0">
        <Avatar size={size}>
          {avatarUrl && <Avatar.Image alt="" src={avatarUrl} />}
          <Avatar.Fallback>{getInitials(name, email)}</Avatar.Fallback>
        </Avatar>
        {badge}
      </span>

      <span className={['flex min-w-0 flex-col', textClassName].filter(Boolean).join(' ')}>
        <span className="truncate font-medium text-foreground" title={primary}>
          {primary}
        </span>
        {secondary && (
          <span className="truncate text-xs text-muted" title={secondary}>
            {secondary}
          </span>
        )}
      </span>
    </div>
  );
}
