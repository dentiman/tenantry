import { Building2 } from 'lucide-react';
import { Avatar, AvatarFallback } from '@saas-skeleton/ui/components/ui/avatar';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@saas-skeleton/ui/components/ui/item';

interface TenantIdentityProps {
  /** Ключ колірного тінта fallback-аватара (`getAvatarTint`) — стабільний, на відміну від назви */
  id: string;
  name: string;
  slug: string;
  /** Розміри реєстру: sm 24px, default 32px (стандарт рядка таблиці), lg 40px */
  size?: 'sm' | 'default' | 'lg';
  className?: string;
}

const ICON_SIZE = { sm: 'size-3', default: 'size-4', lg: 'size-5' } as const;

/**
 * Типографіка двох рядків — дзеркало `UserIdentity`/`CustomerIdentity`: на
 * дефолтних 14/12px рядки майже не відрізняються один від одного, тож
 * `leading-tight`, а не `gap`, дає видиму відстань.
 */
const TEXT = {
  sm: { title: 'text-xs leading-[1.15]', description: 'text-[11px] leading-[1.15]' },
  default: { title: 'leading-tight', description: 'text-xs leading-tight' },
  lg: { title: 'leading-tight', description: 'text-xs leading-tight' },
} as const;

/**
 * Ідентичність тенанта одним блоком — доменний аналог `UserIdentity`/`CustomerIdentity`:
 * скруглений квадрат з іконкою будівлі (той самий вигляд, що організація в
 * `CustomerIdentity`, — тенант завжди організація, дискримінатора kind тут
 * немає) + назва першим рядком, slug моноширинним другим.
 */
export function TenantIdentity({ id, name, slug, size = 'default', className }: TenantIdentityProps) {
  return (
    <Item size="sm" className={['w-auto flex-nowrap gap-3 p-0', className].filter(Boolean).join(' ')}>
      <ItemMedia className="group-has-data-[slot=item-description]/item:translate-y-0 group-has-data-[slot=item-description]/item:self-center">
        <Avatar size={size} className="rounded-md after:rounded-md">
          <AvatarFallback colorSeed={id} className="rounded-md">
            <Building2 aria-hidden className={ICON_SIZE[size]} />
          </AvatarFallback>
        </Avatar>
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0">
        <ItemTitle className={TEXT[size].title} title={name}>
          {name}
        </ItemTitle>
        <ItemDescription className={`font-mono ${TEXT[size].description}`} title={slug}>
          {slug}
        </ItemDescription>
      </ItemContent>
    </Item>
  );
}
