import { describe, expect, it } from 'vitest';
import {
  BROWSER_KEY, COMMENT_MAX, CSV_COLUMNS, FeedbackStore, QUESTIONS, RESPONSES_KEY, cleanComment, csvCell, summarize, toCsv, toJson,
  type StorageLike,
} from '../src/simple/feedback.ts';
import type { RunSummary } from '../src/simple/flow.ts';

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  getItem(k: string): string | null { return this.data.get(k) ?? null; }
  setItem(k: string, v: string): void { this.data.set(k, v); }
  removeItem(k: string): void { this.data.delete(k); }
}

const run: RunSummary = { song: 'twinkle', level: 'easy', finished: true, accuracy: 0.8333, hit: 10, total: 12 };
const at = new Date('2026-10-05T14:30:00Z');

function seeded(seed = 1): () => number {
  let x = seed;
  return () => ((x = (x * 16807) % 2147483647) / 2147483647);
}

describe('FeedbackStore', () => {
  it('saves a response with the answers, the run and nothing that names anyone', () => {
    const storage = new MemoryStorage();
    const store = new FeedbackStore(storage, () => at, seeded());
    const r = store.add(run, 'midi', { fun: 'yes', difficulty: 'just-right', lined_up: 'sometimes', again: 'yes' }, '  the  notes\nwere fast ');
    expect(r).not.toBeNull();
    expect(r).toMatchObject({
      v: 1, at: '2026-10-05T14:30:00.000Z', song: 'twinkle', level: 'easy', input: 'midi', finished: true,
      accuracy: 0.83, hit: 10, total: 12, fun: 'yes', difficulty: 'just-right', lined_up: 'sometimes', again: 'yes', comment: 'the notes were fast',
    });
    expect(Object.keys(r!).sort()).toEqual([...CSV_COLUMNS, 'v'].sort());
    expect(store.all()).toEqual([r]);
    expect(JSON.parse(storage.getItem(RESPONSES_KEY)!)).toHaveLength(1);
  });

  it('keeps one random id per browser', () => {
    const storage = new MemoryStorage();
    const a = new FeedbackStore(storage, () => at, seeded(1));
    const id = a.browserId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(storage.getItem(BROWSER_KEY)).toBe(id);
    const b = new FeedbackStore(storage, () => at, seeded(99));
    expect(b.browserId()).toBe(id);
    a.add(run, null, {});
    b.add(run, 'keyboard', {});
    expect(b.all().map((r) => r.browser)).toEqual([id, id]);
    expect(new FeedbackStore(new MemoryStorage(), () => at, seeded(99)).browserId()).not.toBe(id);
  });

  it('stores an answer that is not an offered option as unanswered', () => {
    const store = new FeedbackStore(new MemoryStorage(), () => at, seeded());
    const r = store.add(run, 'midi', { fun: 'maybe', difficulty: 'too-hard' } as never)!;
    expect(r.fun).toBe('');
    expect(r.difficulty).toBe('too-hard');
    expect(r.lined_up).toBe('');
    expect(r.input).toBe('midi');
  });

  it('appends in order and clears everything but the browser id', () => {
    const storage = new MemoryStorage();
    let t = at.getTime();
    const store = new FeedbackStore(storage, () => new Date((t += 1000)), seeded());
    store.add(run, 'midi', { fun: 'yes' });
    store.add({ ...run, song: 'saints' }, 'midi', { fun: 'no' });
    expect(store.all().map((r) => r.song)).toEqual(['twinkle', 'saints']);
    const id = store.browserId();
    store.clear();
    expect(store.all()).toEqual([]);
    expect(storage.getItem(RESPONSES_KEY)).toBeNull();
    expect(store.browserId()).toBe(id);
  });

  it('survives broken or missing storage', () => {
    const storage = new MemoryStorage();
    storage.setItem(RESPONSES_KEY, '{not json');
    const store = new FeedbackStore(storage, () => at, seeded());
    expect(store.all()).toEqual([]);
    storage.setItem(RESPONSES_KEY, JSON.stringify([{ v: 1, at: 'x' }, 'junk', null, { v: 2 }]));
    expect(store.all()).toHaveLength(1);

    const full: StorageLike = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => undefined };
    const s2 = new FeedbackStore(full, () => at, seeded());
    expect(s2.add(run, 'midi', {})).toBeNull();
    expect(s2.browserId()).toMatch(/^[0-9a-f-]{36}$/);

    const none = new FeedbackStore(null, () => at, seeded());
    expect(none.add(run, 'midi', {})).toBeNull();
    expect(none.all()).toEqual([]);
    expect(() => none.clear()).not.toThrow();
  });
});

describe('comments', () => {
  it('are one line, without control characters, and capped', () => {
    expect(cleanComment('a\tb\r\nc\u0007d')).toBe('a b c d');
    expect(cleanComment('x'.repeat(500))).toHaveLength(COMMENT_MAX);
    expect(cleanComment('   ')).toBe('');
  });
});

describe('export', () => {
  const store = new FeedbackStore(new MemoryStorage(), () => at, seeded());
  store.add(run, 'midi', { fun: 'yes', difficulty: 'too-easy', lined_up: 'yes', again: 'yes' }, 'fun, but "fast"');
  store.add({ ...run, song: 'saints', finished: false, accuracy: 0.2, hit: 2 }, 'keyboard', { fun: 'no' }, '=HYPERLINK("x")');
  const rows = store.all();

  it('writes a CSV with a header row and one line per response', () => {
    const csv = toCsv(rows);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines[1]).toContain(',twinkle,easy,midi,true,0.83,10,12,yes,too-easy,yes,yes,"fun, but ""fast"""');
    expect(lines[2]).toContain(',saints,easy,keyboard,false,0.2,2,12,no,,,,');
  });

  it('never lets a spreadsheet read a cell as a formula', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-2')).toBe("'-2");
    expect(toCsv(rows)).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(null)).toBe('');
  });

  it('writes JSON that reads back to the same responses', () => {
    const json = JSON.parse(toJson(rows, at));
    expect(json.format).toBe('midihero-simple-feedback');
    expect(json.exportedAt).toBe(at.toISOString());
    expect(json.responses).toEqual(rows);
  });

  it('summarizes answers, songs and machines for the teacher view', () => {
    const sum = summarize(rows);
    expect(sum.responses).toBe(2);
    expect(sum.browsers).toBe(1);
    expect(sum.finished).toBe(1);
    expect(sum.comments).toBe(2);
    expect(sum.answers.fun).toEqual({ yes: 1, 'kind-of': 0, no: 1, '': 0 });
    expect(sum.answers.again).toEqual({ yes: 1, no: 0, '': 1 });
    expect(sum.songs).toEqual({ twinkle: { runs: 1, meanAccuracy: 0.83 }, saints: { runs: 1, meanAccuracy: 0.2 } });
    for (const q of QUESTIONS) expect(Object.values(sum.answers[q.key]).reduce((a, b) => a + b, 0)).toBe(2);
  });
});
