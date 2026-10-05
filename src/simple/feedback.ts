/**
 * Student feedback after each simple-mode run, kept on this device only.
 *
 * Students are minors: nothing here touches the network. A response holds the answers, the
 * run's numbers, a timestamp and one random id per browser (so a teacher can tell machines
 * apart in a merged export). No names, no accounts, no analytics. The teacher view exports
 * everything on the machine as CSV or JSON and can clear it.
 */
import type { SimpleLevel } from './config.ts';
import type { InputKind, RunSummary } from './flow.ts';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const RESPONSES_KEY = 'midihero.simple.feedback.v1';
export const BROWSER_KEY = 'midihero.simple.browser.v1';
export const COMMENT_MAX = 200;

export type QuestionKey = 'fun' | 'difficulty' | 'lined_up' | 'again';

export interface Question {
  key: QuestionKey;
  text: string;
  options: readonly { value: string; label: string }[];
}

/** Four one-tap questions, in the order the form asks them. */
export const QUESTIONS: readonly Question[] = [
  { key: 'fun', text: 'Was it fun?', options: [{ value: 'yes', label: 'Yes' }, { value: 'kind-of', label: 'Kind of' }, { value: 'no', label: 'No' }] },
  { key: 'difficulty', text: 'How hard was it?', options: [{ value: 'too-easy', label: 'Too easy' }, { value: 'just-right', label: 'Just right' }, { value: 'too-hard', label: 'Too hard' }] },
  { key: 'lined_up', text: 'When you pressed a key, did the game match what you played?', options: [{ value: 'yes', label: 'Yes' }, { value: 'sometimes', label: 'Sometimes' }, { value: 'no', label: 'No' }] },
  { key: 'again', text: 'Would you play it again?', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
];

export type Answers = Partial<Record<QuestionKey, string>>;

export interface FeedbackResponse {
  /** record format */
  v: 1;
  /** random id of this browser, not of a person */
  browser: string;
  /** ISO time the form was saved */
  at: string;
  song: string;
  level: SimpleLevel;
  input: InputKind | '';
  finished: boolean;
  /** 0..1, two decimals */
  accuracy: number;
  hit: number;
  total: number;
  fun: string;
  difficulty: string;
  lined_up: string;
  again: string;
  comment: string;
}

export const CSV_COLUMNS: readonly (keyof FeedbackResponse)[] = [
  'at', 'browser', 'song', 'level', 'input', 'finished', 'accuracy', 'hit', 'total', 'fun', 'difficulty', 'lined_up', 'again', 'comment',
];

/** A comment as stored: one line, no control characters, at most COMMENT_MAX characters. */
export function cleanComment(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, COMMENT_MAX);
}

/** Only an offered option is kept; anything else is stored as unanswered. */
function answerOf(q: QuestionKey, answers: Answers): string {
  const v = answers[q];
  const question = QUESTIONS.find((x) => x.key === q)!;
  return v && question.options.some((o) => o.value === v) ? v : '';
}

const isResponse = (r: unknown): r is FeedbackResponse =>
  !!r && typeof r === 'object' && (r as FeedbackResponse).v === 1 && typeof (r as FeedbackResponse).at === 'string';

export function randomId(random: () => number = Math.random): string {
  const c = globalThis.crypto;
  if (c?.randomUUID && random === Math.random) return c.randomUUID();
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(random() * 16).toString(16);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

export class FeedbackStore {
  constructor(
    private readonly storage: StorageLike | null,
    private readonly clock: () => Date = () => new Date(),
    private readonly random: () => number = Math.random,
  ) {}

  /** This browser's random id, made on first use. Without storage, a fresh one each time. */
  browserId(): string {
    try {
      const existing = this.storage?.getItem(BROWSER_KEY);
      if (existing) return existing;
      const id = randomId(this.random);
      this.storage?.setItem(BROWSER_KEY, id);
      return id;
    } catch {
      return randomId(this.random);
    }
  }

  all(): FeedbackResponse[] {
    try {
      const raw = this.storage?.getItem(RESPONSES_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(isResponse) : [];
    } catch {
      return [];
    }
  }

  /** Save one response. Returns it, or null when the device would not store it. */
  add(run: RunSummary, input: InputKind | null, answers: Answers, comment = ''): FeedbackResponse | null {
    const response: FeedbackResponse = {
      v: 1,
      browser: this.browserId(),
      at: this.clock().toISOString(),
      song: run.song,
      level: run.level,
      input: input ?? '',
      finished: run.finished,
      accuracy: Math.round(run.accuracy * 100) / 100,
      hit: run.hit,
      total: run.total,
      fun: answerOf('fun', answers),
      difficulty: answerOf('difficulty', answers),
      lined_up: answerOf('lined_up', answers),
      again: answerOf('again', answers),
      comment: cleanComment(comment),
    };
    try {
      if (!this.storage) return null;
      this.storage.setItem(RESPONSES_KEY, JSON.stringify([...this.all(), response]));
      return response;
    } catch {
      return null;
    }
  }

  /** Remove every response on this device. The browser id stays. */
  clear(): void {
    try {
      this.storage?.removeItem(RESPONSES_KEY);
    } catch {
      /* storage unavailable */
    }
  }
}

/** A CSV cell: quoted when needed, and never read as a formula by a spreadsheet. */
export function csvCell(value: unknown): string {
  let s = value === undefined || value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: readonly FeedbackResponse[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(r[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

export function toJson(rows: readonly FeedbackResponse[], exportedAt: Date = new Date()): string {
  return JSON.stringify({ format: 'midihero-simple-feedback', version: 1, exportedAt: exportedAt.toISOString(), responses: rows }, null, 2);
}

export interface Summary {
  responses: number;
  browsers: number;
  finished: number;
  comments: number;
  /** answer counts per question, unanswered as '' */
  answers: Record<QuestionKey, Record<string, number>>;
  /** per song: runs and mean accuracy */
  songs: Record<string, { runs: number; meanAccuracy: number }>;
}

export function summarize(rows: readonly FeedbackResponse[]): Summary {
  const answers = Object.fromEntries(QUESTIONS.map((q) => [q.key, Object.fromEntries([...q.options.map((o) => [o.value, 0]), ['', 0]])])) as Summary['answers'];
  const songs: Summary['songs'] = {};
  const sums: Record<string, number> = {};
  for (const r of rows) {
    for (const q of QUESTIONS) {
      const v = r[q.key] ?? '';
      answers[q.key][v] = (answers[q.key][v] ?? 0) + 1;
    }
    const s = (songs[r.song] ??= { runs: 0, meanAccuracy: 0 });
    s.runs++;
    sums[r.song] = (sums[r.song] ?? 0) + r.accuracy;
  }
  for (const [id, s] of Object.entries(songs)) s.meanAccuracy = Math.round((sums[id]! / s.runs) * 100) / 100;
  return {
    responses: rows.length,
    browsers: new Set(rows.map((r) => r.browser)).size,
    finished: rows.filter((r) => r.finished).length,
    comments: rows.filter((r) => r.comment).length,
    answers,
    songs,
  };
}
