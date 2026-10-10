import { useEffect, useRef } from 'react';
import { useMessageScrollerScrollable } from '@saas-skeleton/ui/components/ui/message-scroller';
import { shouldReportRead, useWindowActive } from './read-on-view';

interface ReadOnViewTrackerProps {
  newestSeq: number;
  /** З якої позиції курсор уже підтверджений сервером — її не повторюємо */
  initialReportedSeq: number;
  onRead: (seq: number) => void;
}

/**
 * Невидимий компонент, що звіряє три речі — вікно, кінець стрічки, найновіший `seq` — і
 * рухає курсор у момент, коли всі три зійшлись. Живе ВСЕРЕДИНІ `MessageScrollerProvider`:
 * стан «кінець видно» віддає хук примітива, а хуки примітива працюють лише під ним.
 *
 * `scrollable.end` = «нижче вʼюпорта є вміст», тож «кінець на екрані» — це `!end`. Коротка
 * розмова, що вміщується у вʼюпорт, прокручувати нема куди, тобто кінець завжди на екрані.
 * Ефект перезапускається на зміну будь-якого входу — тому повернення у вікно чи прокрутка
 * донизу звітують у ту ж мить.
 */
export function ReadOnViewTracker({
  newestSeq,
  initialReportedSeq,
  onRead,
}: ReadOnViewTrackerProps) {
  const { end } = useMessageScrollerScrollable();
  const windowActive = useWindowActive();
  const reportedSeq = useRef(initialReportedSeq);

  useEffect(() => {
    if (
      shouldReportRead({ windowActive, atEnd: !end, newestSeq, reportedSeq: reportedSeq.current })
    ) {
      reportedSeq.current = newestSeq;
      onRead(newestSeq);
    }
  }, [windowActive, end, newestSeq, onRead]);

  return null;
}
