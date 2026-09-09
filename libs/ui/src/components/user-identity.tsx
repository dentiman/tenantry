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
  /** Ключ колірного тінта fallback-аватара (`getAvatarTint`) — стабільний, на відміну від email/name */
  id: string;
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
  /**
   * Другий рядок (пошта). Вимикається там, де ідентичність мусить лишитись
   * ОДНОрядковою через геометрію контейнера, а не через брак місця під текст:
   * чип у полі має 28px висоти — два рядки туди не влазять фізично.
   * Не `size='xs'`: кегль і аватар лишаються ті самі, зникає рівно один рядок.
   */
  showEmail?: boolean;
}

/**
 * Типографіка двох рядків. `sm` — не просто менший аватар: із дефолтними 14/12px
 * рядки майже не відрізнялись один від одного і разом були ВИЩІ за сам аватар
 * 24px, тож блок читався як два окремі рядки тексту, а не як одна двоярусна
 * ідентичність. У компактному вигляді кегль падає на щабель (12/11px), а
 * міжрядковий інтервал стискається сильніше за `leading-tight` — саме він, а не
 * `gap` (той нульовий), і створює видиму відстань між іменем і поштою.
 */
const TEXT = {
  sm: { title: 'text-xs leading-[1.15]', description: 'text-[11px] leading-[1.15]' },
  default: { title: 'leading-tight', description: 'text-xs leading-tight' },
  lg: { title: 'leading-tight', description: 'text-xs leading-tight' },
} as const;

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
 * (замінений кустарний медіа-обʼєкт — docs/frontend/ui-migration-history.md §4).
 * Три класи-перевизначення свідомі:
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
  id,
  email,
  name,
  avatarUrl,
  size = 'default',
  badge,
  className,
  textClassName,
  showEmail = true,
}: UserIdentityProps) {
  const displayName = name?.trim() ? name.trim() : null;
  const primary = displayName ?? email;
  // Без імені в першому рядку вже стоїть пошта — ховати «другий рядок» нічого
  const secondary = displayName && showEmail ? email : null;

  return (
    // flex-nowrap: стоковий Item переносить вміст, і у вузькому контейнері
    // (згорнутий сайдбар) текст падав би під аватар замість того, щоб обрізатись
    <Item
      size="sm"
      className={['w-auto flex-nowrap gap-3 p-0', className].filter(Boolean).join(' ')}
    >
      {/* Аватар по центру блоку: стоковий ItemMedia притискає медіа до верху і зсуває
          на 2px, бо розрахований на багаторядковий опис — тут рядків рівно два.
          Перевизначення мусить нести ТОЙ САМИЙ варіант, що й стокове правило:
          голі `self-center`/`translate-y-0` програють `group-has-…:self-start` за
          специфічністю (tailwind-merge їх навіть не вважає конфліктом і лишає
          обидва), і центрування було мертвим кодом — з `size="sm"` аватар 24px
          помітно висів угорі двох рядків тексту, бо ті вищі за нього */}
      <ItemMedia className="group-has-data-[slot=item-description]/item:translate-y-0 group-has-data-[slot=item-description]/item:self-center">
        <Avatar size={size}>
          {avatarUrl && <AvatarImage alt="" src={avatarUrl} />}
          <AvatarFallback colorSeed={id}>{getInitials(name, email)}</AvatarFallback>
          {badge}
        </Avatar>
      </ItemMedia>
      <ItemContent className={['min-w-0 gap-0', textClassName].filter(Boolean).join(' ')}>
        {/* Стискання рядків замість стокових snug/normal: між іменем і поштою не
            має бути повітря, якого не витримує ні рядок таблиці, ні тригер поля */}
        <ItemTitle className={TEXT[size].title} title={primary}>
          {primary}
        </ItemTitle>
        {secondary && (
          <ItemDescription className={TEXT[size].description} title={secondary}>
            {secondary}
          </ItemDescription>
        )}
      </ItemContent>
    </Item>
  );
}
