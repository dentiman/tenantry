import { Building2 } from 'lucide-react';
import type { CustomerKind } from '@saas-skeleton/contracts';
import { Avatar, AvatarFallback } from '@saas-skeleton/ui/components/ui/avatar';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@saas-skeleton/ui/components/ui/item';
import { formatForDisplay } from '../../../components/form/phone/phone-format';

interface CustomerIdentityProps {
  /** Ключ колірного тінта fallback-аватара (`getAvatarTint`) — стабільний, на відміну від імені */
  id: string;
  /** Дискримінатор сутності: від нього залежить і форма медіа, і його вміст */
  kind: CustomerKind;
  name: string;
  email?: string | null;
  /** E.164 з API — до людського вигляду доводиться тут, як у решті UI */
  phone?: string | null;
  /** Людський номер («C-000123») — останній рубіж другого рядка, у шапці — єдиний */
  numberLabel?: string | null;
  /**
   * Роль блоку, а не просто розмір шрифту:
   * - `row` (дефолт) — рядок списку: дрібний титул, другий рядок за пріоритетом
   *   email → телефон → номер (у списку цінне те, чим можна звʼязатись).
   * - `header` — шапка картки: титул рівня сторінки (`h1`, text-2xl), другий рядок
   *   ЗАВЖДИ людський номер. На картці контакти вже розписані у вкладці Overview,
   *   а під іменем потрібен стабільний ідентифікатор, який не стрибає між
   *   записами залежно від заповненості полів.
   */
  variant?: 'row' | 'header';
  /** Розміри реєстру: sm 24px, default 32px (стандарт рядка таблиці), lg 40px */
  size?: 'sm' | 'default' | 'lg';
  /** Класи кореня (відступи/ширина від споживача) */
  className?: string;
  /** Класи текстового блоку — escape hatch: `hidden sm:flex` лишає саме медіа */
  textClassName?: string;
}

/** Розмір іконки будівлі під розмір аватара (24/32/40 → 12/16/20 px) */
const ICON_SIZE = { sm: 'size-3', default: 'size-4', lg: 'size-5' } as const;

/**
 * Типографіка двох рядків — дзеркало `UserIdentity` (`libs/ui`), причина там же:
 * на дефолтних 14/12px рядки майже не відрізняються один від одного, а поруч із
 * аватаром 24px блок тексту виявляється ВИЩИМ за саме медіа. У компактному
 * вигляді кегль падає на щабель, а міжрядковий інтервал стискається сильніше за
 * `leading-tight` — саме він, а не `gap` (той нульовий), і дає видиму відстань.
 * Титул шапки сюди не входить: `header` — це `h1` рівня сторінки з власною
 * типографікою, і масштабується він кеглем заголовка, а не розміром медіа.
 */
const TEXT = {
  sm: { title: 'text-xs leading-[1.15]', description: 'text-[11px] leading-[1.15]' },
  default: { title: 'leading-tight', description: 'text-xs leading-tight' },
  lg: { title: 'leading-tight', description: 'text-xs leading-tight' },
} as const;

/**
 * Ініціали фізособи: «Ada Lovelace» → «AL», «Ada» → «AD». Береться перша літера
 * ДВОХ слів, а не перші дві літери рядка — так блок читається як особа.
 */
function getInitials(name: string): string {
  const [first, second] = name.trim().split(/\s+/).filter(Boolean);
  if (first && second) return (first.charAt(0) + second.charAt(0)).toUpperCase();
  return (first ?? '').slice(0, 2).toUpperCase();
}

/**
 * Ідентичність кастомера одним блоком — доменний аналог `UserIdentity` (`libs/ui`):
 * медіа зліва, два рядки тексту справа. Живе в застосунку, а не в пакеті, бо
 * `Customer` існує тільки в tenant-плані (у platform-web його немає).
 *
 * Рішення:
 * - **Форма медіа кодує `kind`**: фізособа — кругла плитка з ініціалами (той самий
 *   вигляд, що аватар юзера), організація — скруглений КВАДРАТ з іконкою будівлі.
 *   Так тип контрагента видно до читання тексту, і в списку не треба окремої
 *   колонки «Тип». Круг для компанії був би брехнею впізнаваності: у всіх CRM
 *   круг = людина.
 * - **Другий рядок залежить від ролі блоку, а не задається ззовні рядком.** У списку
 *   (`row`) це перше НАЯВНЕ з email → телефон → номер: у кастомера обов'язкове лише
 *   ім'я, тож жорстко вибране поле давало б порожній рядок у половини записів, а
 *   порядок веде від найкориснішого для звʼязку до гарантованого (`numberLabel` є
 *   завжди, тому блок ніколи не втрачає другий рядок). У шапці картки (`header`)
 *   пріоритет навпаки шкодить: контакти вже розписані у вкладці Overview, а під
 *   іменем потрібен СТАБІЛЬНИЙ ідентифікатор — тому там завжди номер. Правило
 *   лишається в компоненті, а не в пропі-перевизначенні: інакше кожен наступний
 *   виклик заново вирішував би, що показати під іменем.
 * - Логотипа немає свідомо: поля під нього в `Customer` не існує, і проп-заглушка
 *   була б готовим кодом без споживача.
 */
export function CustomerIdentity({
  id,
  kind,
  name,
  email,
  phone,
  numberLabel,
  variant = 'row',
  size = 'default',
  className,
  textClassName,
}: CustomerIdentityProps) {
  const isOrganization = kind === 'ORGANIZATION';
  const isHeader = variant === 'header';
  // `find` по списку, а не ланцюжок `||`: порожній рядок (API віддає його замість
  // null у полях, які ніколи не заповнювали) мусить пропускатись далі, а `??` його
  // пропустив би за значення
  const secondary = isHeader
    ? numberLabel?.trim()
    : [email?.trim(), formatForDisplay(phone), numberLabel?.trim()].find((value) => Boolean(value));

  return (
    // flex-nowrap: стоковий Item переносить вміст, і у вузькій клітинці текст
    // падав би під медіа замість того, щоб обрізатись
    <Item
      size="sm"
      className={['w-auto flex-nowrap gap-3 p-0', className].filter(Boolean).join(' ')}
    >
      {/* Медіа по центру блоку: стоковий ItemMedia притискає його до верху,
          бо розрахований на багаторядковий опис — тут рядків рівно два.
          Варіант у перевизначенні обовʼязковий — про причину див. `UserIdentity` */}
      <ItemMedia className="group-has-data-[slot=item-description]/item:translate-y-0 group-has-data-[slot=item-description]/item:self-center">
        {/* rounded-md перекриває rounded-full примітива (і його рамку в ::after) —
            тому tailwind-merge, а не власна верстка аватара */}
        <Avatar size={size} className={isOrganization ? 'rounded-md after:rounded-md' : undefined}>
          <AvatarFallback
            colorSeed={id}
            className={isOrganization ? 'rounded-md' : undefined}
          >
            {isOrganization ? (
              // Декоративна: тип уже названо текстом у гріді/картці
              <Building2 aria-hidden className={ICON_SIZE[size]} />
            ) : (
              getInitials(name)
            )}
          </AvatarFallback>
        </Avatar>
      </ItemMedia>
      <ItemContent className={['min-w-0 gap-0', textClassName].filter(Boolean).join(' ')}>
        {/* Стискання рядків замість стокових snug/normal: повітря, яке примітив
            лишає між рядками, не витримує ні рядок таблиці, ні тригер поля */}
        {isHeader ? (
          // Явний <h1>, а не ItemTitle: шапка мусить лишитись заголовком першого
          // рівня сторінки (як на решті сторінок web), а примітив реєстру фіксовано
          // рендерить <div> і render-пропа не має. Від нього тут лишилось би саме
          // обрізання — типографіку заголовок і так перевизначає всю
          <h1
            // `-mb-[0.16em]` підрізає простір ПІД назвою. Він не від `gap` (той 0) —
            // це власний підрядковий простір шрифту (descender, ~0.24em у Inter):
            // він росте разом із кеглем, тож на text-2xl читається як зайвий відступ,
            // а на text-sm у рядку гріда — ні. Тому в `em`, а не в пікселях: правило
            // лишається правильним за будь-якого розміру заголовка
            className="line-clamp-1 -mb-[0.12em] text-2xl leading-tight font-bold tracking-tight text-foreground"
            title={name}
          >
            {name}
          </h1>
        ) : (
          <ItemTitle className={TEXT[size].title} title={name}>
            {name}
          </ItemTitle>
        )}
        {secondary && (
          <ItemDescription
            // Номер моноширинним — той самий вигляд, що в колонці «Number» гріда:
            // одне й те саме значення не має виглядати на двох екранах по-різному
            className={
              isHeader
                ? `font-mono tabular-nums ${TEXT[size].description}`
                : TEXT[size].description
            }
            title={secondary}
          >
            {secondary}
          </ItemDescription>
        )}
      </ItemContent>
    </Item>
  );
}
