import { useTranslation } from 'react-i18next';
import {
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
} from '@saas-skeleton/ui/components/ui/combobox';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { UserIdentity } from '@saas-skeleton/ui/components/user-identity';
import { UserPresenceBadge } from '../presence-dot';
import type { UserOption } from './user-option';

interface UserPickerListProps {
  /** Скільки рядків реально показано — для чесної межі внизу попапа */
  shown: number;
  total: number;
  isFetching: boolean;
  /** Юзери, яких зі складу вибити не можна: у списку вони вимкнені, не зняті */
  lockedIds: string[];
}

/**
 * Тіло попапа — спільне для обох варіантів. Це той самий список, що в
 * `UserSelect`: серверний пошук, 20 рядків, чесний підсумок «є ще, але не тут».
 * Єдине, чого там немає — галочки: її малює `ComboboxItem` реєстру сам, щойно
 * `Combobox` переходить у `multiple`.
 *
 * Компонент не приймає `options` пропом: рядки роздає `ComboboxList` із `items`
 * кореня — інакше довелось би тримати список у двох місцях і стежити, щоб
 * підсвітка з клавіатури й фактичний рендер не розійшлись.
 */
export function UserPickerList({ shown, total, isFetching, lockedIds }: UserPickerListProps) {
  const { t } = useTranslation('common');

  return (
    <>
      <ComboboxEmpty>{isFetching ? <Spinner /> : t('userSelect.notFound')}</ComboboxEmpty>
      <ComboboxList className="max-h-[248px]">
        {(option: UserOption) => (
          <ComboboxItem
            key={option.id}
            value={option}
            // Заблокований юзер лишається видимим і позначеним, але вимкненим:
            // прибрати організатора кліком у списку — те саме, що прибрати його
            // чипом, і мовчазне ігнорування було б гіршим за явно сірий рядок
            disabled={lockedIds.includes(option.id)}
            className="py-1.5"
          >
            <UserIdentity
              size="sm"
              email={option.email}
              name={option.name}
              avatarUrl={option.avatarUrl}
              badge={<UserPresenceBadge userId={option.id} />}
            />
          </ComboboxItem>
        )}
      </ComboboxList>
      {total > shown && (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          {t('userSelect.refine', { shown, total })}
        </p>
      )}
    </>
  );
}
