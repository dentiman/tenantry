import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlaskConical } from 'lucide-react';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Input } from '@saas-skeleton/ui/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@saas-skeleton/ui/components/ui/popover';
import { Textarea } from '@saas-skeleton/ui/components/ui/textarea';
import { axiosInstance } from '../../../api/http-client';

/**
 * DEV-ПАНЕЛЬ симулятора вхідних (CHAT-2a, design.md D9): надсилає «повідомлення клієнта» через
 * `/api/dev/chat/*` — тим самим підписаним вебхуком, що й справжній провайдер. Рендериться лише
 * під `import.meta.env.DEV`: у production-збірці вона відсікається разом із цим файлом, а
 * сервер без `CHAT_DEV_TOOLS` однаково відповідає 404.
 *
 * Тексти тут свідомо англійські й не йдуть через i18n: це інструмент розробника, а не продукт.
 */
export function SimulateInboundPopover() {
  const { t } = useTranslation('chat');
  const [from, setFrom] = useState('+380501234567');
  const [name, setName] = useState('Olena');
  const [text, setText] = useState('Hello! This is a simulated message.');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [detail, setDetail] = useState('');

  async function send(): Promise<void> {
    setState('sending');
    try {
      await axiosInstance.post('/api/dev/chat/fake-channel');
      const { data } = await axiosInstance.post<{ webhookStatus: number }>(
        '/api/dev/chat/simulate',
        {
          from,
          text,
          profileName: name || undefined,
        },
      );
      setState(data.webhookStatus === 200 ? 'sent' : 'error');
      setDetail(`webhook ${String(data.webhookStatus)}`);
    } catch (error) {
      setState('error');
      setDetail(error instanceof Error ? error.message : 'failed');
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-xs" aria-label={t('inbox.simulate.open')}>
            <FlaskConical />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-80">
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">{t('inbox.simulate.hint')}</p>
          <Input
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
            }}
            aria-label="From"
          />
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            aria-label="Name"
          />
          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
            aria-label="Text"
            rows={3}
          />
          <Button
            size="sm"
            disabled={state === 'sending' || text.trim() === ''}
            onClick={() => void send()}
          >
            {t('inbox.simulate.send')}
          </Button>
          {state !== 'idle' && state !== 'sending' && (
            <p className={state === 'sent' ? 'text-xs text-success' : 'text-xs text-destructive'}>
              {state === 'sent' ? t('inbox.simulate.sent') : t('inbox.simulate.failed')} ({detail})
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
