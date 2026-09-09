import { useCallback, useEffect, useRef, useState } from 'react';

/** Скільки тримається стан «скопійовано» (підказка/іконка) після кліку */
const DEFAULT_RESET_MS = 1500;

/**
 * Легасі-шлях запису в буфер: прихована textarea + `document.execCommand('copy')`.
 *
 * Потрібен НЕ заради старих браузерів, а заради НЕЗАХИЩЕНОГО контексту: у
 * `window.isSecureContext === false` (а це рівно наш тестовий прод — http на
 * IP:port, `docs/deploy-swarm.md`) `navigator.clipboard` просто відсутній.
 * Без фолбека копіювання мовчки не працювало б саме там, де його перевіряють.
 *
 * `execCommand` формально deprecated, але лишається єдиним синхронним API, яке
 * браузери досі підтримують; викликати його можна ТІЛЬКИ всередині обробника
 * жесту користувача — тому копіювання не робиться «по таймеру» чи після await.
 */
function copyWithExecCommand(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  // Поза екраном, але у DOM: readOnly гасить клавіатуру на мобільних,
  // фіксована позиція не дає сторінці стрибнути від фокуса
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);

  const selection = document.getSelection();
  const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  textarea.select();
  let isCopied = false;
  try {
    // Свідомо: у незахищеному контексті (http на IP — наш тестовий прод)
    // Clipboard API немає, а синхронної заміни execCommand браузери не дали
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    isCopied = document.execCommand('copy');
  } catch {
    isCopied = false;
  }

  document.body.removeChild(textarea);
  // Відновлюємо виділення, яке було до копіювання — інакше клік по номеру
  // знімав би виділений користувачем текст сторінки
  if (previousRange && selection) {
    selection.removeAllRanges();
    selection.addRange(previousRange);
  }
  return isCopied;
}

async function writeToClipboard(text: string): Promise<boolean> {
  // Async Clipboard API — основний шлях (Chrome/Safari/Firefox, https або localhost)
  // Типи DOM оголошують `clipboard` обовʼязковим, у незахищеному контексті його
  // немає — звідси явна анотація, інакше strict-lint зніс би перевірку як зайву
  const clipboard: Clipboard | undefined = navigator.clipboard;
  if (clipboard) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Відмова в дозволі або незахищений контекст — пробуємо легасі-шлях
    }
  }
  return copyWithExecCommand(text);
}

export interface UseCopyToClipboard {
  /** Копіює рядок; повертає, чи вдалося (щоб споживач міг показати помилку) */
  copy: (text: string) => Promise<boolean>;
  /** true протягом `resetMs` після вдалого копіювання */
  isCopied: boolean;
}

/**
 * Копіювання в буфер обміну без сторонніх пакетів.
 *
 * Бібліотеки (`copy-to-clipboard`, `react-copy-to-clipboard`, `usehooks-ts`)
 * розглянуто й відхилено: вони важать більше за цей файл і всі так само
 * зводяться до пари «Clipboard API + execCommand-фолбек».
 */
export function useCopyToClipboard(resetMs: number = DEFAULT_RESET_MS): UseCopyToClipboard {
  const [isCopied, setIsCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string) => {
      const isDone = await writeToClipboard(text);
      if (!isDone) return false;

      setIsCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setIsCopied(false);
      }, resetMs);
      return true;
    },
    [resetMs],
  );

  return { copy, isCopied };
}
