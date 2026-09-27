/** Один кадр дельти, готовий до емісії в socket */
export interface CoalescedFrame {
  readonly chunkSeq: number;
  readonly text: string;
}

/**
 * Коалесування кадрів провайдера в кадри сокету (AI-0.1, design.md D8). Чистий
 * клас: жодного Nest, жодного I/O — усе, що робить `AiGenerateReplySubscriber`
 * тестованим без БД і без мережі. Виділено з нього без зміни правила
 * (докладніше — оригінальний коментар у subscriber-і до цієї зміни): кадр
 * віддається або по таймеру `flushIntervalMs`, або на межі абзацу, інакше
 * хвіст відповіді чекав би повний інтервал після останнього кадру провайдера.
 *
 * Володіє і `chunkSeq`, і накопиченим текстом — і те, й інше є частиною
 * контракту дельт (`ai.message-delta.v1.chunkSeq`, `ai_messages.chunk_count`),
 * тож мають рахуватись в одному місці, а не окремими лічильниками, які могли б
 * розійтися.
 */
export class ChunkCoalescer {
  private text = '';
  private pending = '';
  private chunkSeq = 0;
  private lastFlushAt: number;

  constructor(
    private readonly flushIntervalMs: number,
    now: number = Date.now(),
  ) {
    this.lastFlushAt = now;
  }

  /** Накопичений текст усіх кадрів, ВЖЕ відданих через `push`/`flush` */
  get accumulatedText(): string {
    return this.text;
  }

  /** Скільки кадрів уже віддано — те саме число, що йде в `ai_messages.chunk_count` */
  get chunkCount(): number {
    return this.chunkSeq;
  }

  /**
   * Додає кадр від провайдера. Повертає кадр для емісії, якщо настав момент
   * зафлашити накопичене (за часом або на межі абзацу), інакше `null` —
   * викликач нічого не емітує і не пише проміжний стан.
   */
  push(chunkText: string, now: number): CoalescedFrame | null {
    this.pending += chunkText;

    const dueByTime = now - this.lastFlushAt >= this.flushIntervalMs;
    const dueByParagraph = this.pending.endsWith('\n\n');
    if (this.pending.length === 0 || !(dueByTime || dueByParagraph)) {
      return null;
    }

    return this.flushPending(now);
  }

  /**
   * Викликається ОДИН РАЗ по завершенню стріму (успішному чи ні): віддає хвіст,
   * що ще не досяг межі коалесування. `null`, якщо накопичувати вже нічого.
   */
  flush(now: number = Date.now()): CoalescedFrame | null {
    if (this.pending.length === 0) {
      return null;
    }
    return this.flushPending(now);
  }

  private flushPending(now: number): CoalescedFrame {
    const frame: CoalescedFrame = { chunkSeq: this.chunkSeq, text: this.pending };
    this.text += this.pending;
    this.pending = '';
    this.chunkSeq += 1;
    this.lastFlushAt = now;
    return frame;
  }
}
