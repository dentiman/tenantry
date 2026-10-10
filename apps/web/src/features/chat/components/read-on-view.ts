import { useSyncExternalStore } from 'react';

/**
 * Чи рухати курсор прочитаного: лише коли людина ДИВИТЬСЯ — вікно видиме й у фокусі, а
 * найновіше повідомлення на екрані (docs/chat.md §4.8.2). Раніше курсор їхав, щойно в кеші
 * зʼявлявся новіший `seq`; відколи повідомлення стали приходити наживо, це означало, що
 * репліка, яка прилетіла у фонову вкладку, мовчки ставала прочитаною, і бейдж не зʼявлявся
 * саме для того, кому призначений.
 *
 * Чиста функція — таблиця істинності перевіряється тестом без DOM.
 */
export function shouldReportRead(input: {
  windowActive: boolean;
  atEnd: boolean;
  newestSeq: number;
  reportedSeq: number;
}): boolean {
  return input.windowActive && input.atEnd && input.newestSeq > input.reportedSeq;
}

function isWindowActive(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}

function subscribe(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  window.addEventListener('focus', onChange);
  window.addEventListener('blur', onChange);
  return () => {
    document.removeEventListener('visibilitychange', onChange);
    window.removeEventListener('focus', onChange);
    window.removeEventListener('blur', onChange);
  };
}

/**
 * Вікно видиме і в фокусі. Застереження: `document.hasFocus()` хибно-негативний, коли фокус у
 * iframe чи devtools; збій у «безпечний» бік — розмова лишається непрочитаною трохи довше.
 */
export function useWindowActive(): boolean {
  return useSyncExternalStore(subscribe, isWindowActive, () => false);
}
