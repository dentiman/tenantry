/**
 * Вирізає з недовіреного тексту всі збіги тега огорожі ДО нерухомої точки. Одного `replace` мало:
 * він нерекурсивний, і `<</excerpt>/excerpt>` після видалення вкладеного `</excerpt>` зсувається
 * в справжній `</excerpt>` — текст «закрив» би огорожу, яку вирізання мало захищати. Кожен прохід
 * лише скорочує рядок, тож цикл скінченний.
 */
export function stripUntilStable(text: string, tag: RegExp): string {
  let current = text;
  for (;;) {
    const next = current.replace(tag, '');
    if (next === current) {
      return next;
    }
    current = next;
  }
}
