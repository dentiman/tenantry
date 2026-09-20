import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@saas-skeleton/ui/lib/utils';

/**
 * Рендер відповіді асистента — і ЦЕ МЕЖА XSS, а не косметика.
 *
 * Відповідь моделі — недовірений ввід: у AI-0 її складає провайдер, а в AI-2
 * частину вхідних даних пише адмін ІНШОГО тенанта. Тому:
 *
 * - жодного `rehype-raw` і жодного `dangerouslySetInnerHTML`: сирий HTML у
 *   Markdown-джерелі лишається ТЕКСТОМ (react-markdown так поводиться за
 *   замовчуванням, і ми свідомо цього не вимикаємо);
 * - посилання пропускаються лише з http/https, відкриваються в новій вкладці з
 *   `rel="noopener noreferrer"` — інакше `javascript:` і `data:` URL стали б
 *   виконуваними, а `window.opener` — доступним чужій сторінці.
 *
 * Рендерер введено ОДРАЗУ, а не «текстом зараз, розміткою потім»: додавати межу
 * після того, як панель уже показує вивід моделі, означає випустити небезпечну
 * версію першою.
 */

const SAFE_PROTOCOLS = ['http:', 'https:'];

/**
 * Без `window.location` як бази: відносне посилання розпізнається за формою, і
 * функція лишається чистою — її видно з тесту в node-оточенні.
 */
function isSafeHref(href: string | undefined): boolean {
  if (!href) {
    return false;
  }
  // Відносний шлях або якір виконуваним бути не може
  if (href.startsWith('/') || href.startsWith('#')) {
    return true;
  }
  try {
    return SAFE_PROTOCOLS.includes(new URL(href).protocol);
  } catch {
    // Не абсолютний URL і не схожий на шлях — не ризикуємо
    return false;
  }
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        'text-sm leading-relaxed [&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5',
        '[&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-base [&_h1]:font-semibold',
        '[&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold',
        '[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-medium',
        '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]',
        '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3',
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
        '[&_a]:underline [&_a]:underline-offset-2',
        '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: linkChildren }) =>
            isSafeHref(href) ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {linkChildren}
              </a>
            ) : (
              // Небезпечний протокол не мовчимо і не ковтаємо — показуємо текстом
              <>{linkChildren}</>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
