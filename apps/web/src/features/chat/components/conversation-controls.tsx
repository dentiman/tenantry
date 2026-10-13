import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@saas-skeleton/ui/components/ui/select';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import {
  getChatFindOneQueryKey,
  useChatSetAssignee,
  useChatSetStatus,
} from '../../../api/generated/api';
import type { ConversationResponseDtoOutput } from '../../../api/generated/model/conversationResponseDtoOutput';
import { UserSelect } from '../../users/components/user-select';
import { INBOX_KEY_PREFIX, conversationListKey, transcriptKey } from '../chat-keys';

const STATUSES = ['OPEN', 'PENDING', 'RESOLVED'] as const;
type SettableStatus = (typeof STATUSES)[number];

function isSettable(value: string): value is SettableStatus {
  return (STATUSES as readonly string[]).includes(value);
}

/**
 * Статус і відповідальний за клієнтську розмову (CHAT-2b) — у шапці. Без оптимістичного оновлення:
 * сервер пише запис у стрічку й активність, тож після успіху перечитуються картка, стрічка й
 * скринька, а не домальовується вгадане. Конфлікт (в контакта вже є інша відкрита розмова) —
 * тост, а не мовчазна відмова.
 */
export function ConversationControls({ conversation }: { conversation: ConversationResponseDtoOutput }) {
  const { t } = useTranslation('chat');
  const queryClient = useQueryClient();

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getChatFindOneQueryKey(conversation.id) }),
      queryClient.invalidateQueries({ queryKey: transcriptKey(conversation.id) }),
      queryClient.invalidateQueries({ queryKey: conversationListKey() }),
      queryClient.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith(INBOX_KEY_PREFIX),
      }),
    ]);
  };
  const onError = (error: unknown): void => {
    const conflict = isAxiosError(error) && error.response?.status === 409;
    toast.add({
      type: 'error',
      title: conflict ? t('controls.errors.statusConflict') : t('controls.errors.failed'),
    });
  };

  const setStatus = useChatSetStatus({
    mutation: { onSuccess: refresh, onError },
  });
  const setAssignee = useChatSetAssignee({
    mutation: { onSuccess: refresh, onError },
  });
  const busy = setStatus.isPending || setAssignee.isPending;

  const items = STATUSES.map((value) => ({ value, label: t(`status.${value.toLowerCase()}`) }));

  return (
    <div className="flex items-center gap-2">
      <Select
        value={conversation.status}
        disabled={busy}
        items={items}
        onValueChange={(next: string | null) => {
          if (next !== null && isSettable(next) && next !== conversation.status) {
            setStatus.mutate({ id: conversation.id, data: { status: next } });
          }
        }}
      >
        <SelectTrigger className="w-36" aria-label={t('controls.status')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <div className="w-56">
        <UserSelect
          value={conversation.assignee?.id ?? null}
          placeholder={t('controls.unassigned')}
          disabled={busy}
          onChange={(userId) => {
            setAssignee.mutate({ id: conversation.id, data: { userId } });
          }}
        />
      </div>
    </div>
  );
}
