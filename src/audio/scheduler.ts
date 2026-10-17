import type { BackingEvent } from '../midi/chart.ts';
import type { GameClock } from './clock.ts';
import type { Synth } from './synth.ts';

export interface SchedulerOptions {
  intervalMs?: number;
  lookaheadSeconds?: number;
  /** part keys whose notes are muted (e.g. a duplicate of the player's part) */
  mutedParts?: Set<string>;
  /** count-in: `beats` clicks, one every `beatSeconds`, ending at song time 0 */
  countIn?: { beats: number; beatSeconds: number } | null;
  /** rhythm channels besides 9 (GS/XG), as in `SongData.drumChannels` */
  drumChannels?: number[];
  setIntervalFn?: (fn: () => void, ms: number) => unknown;
  clearIntervalFn?: (id: unknown) => void;
}

const CLICK_CHANNEL = 9;
const CLICK_PITCH = 37; // side stick
const CLICK_ACCENT = 76; // high wood block

/**
 * Lookahead scheduler for the backing band (Chris Wilson's "two clocks" pattern).
 * Runs on a timer, never on requestAnimationFrame, and schedules every event whose
 * song time falls within the lookahead window at its exact audio-clock time.
 */
export class BackingScheduler {
  private events: BackingEvent[];
  private cursor = 0;
  private timer: unknown = null;
  private readonly intervalMs: number;
  private readonly lookahead: number;
  private readonly muted: Set<string>;
  private readonly drums: Set<number>;
  private readonly setIntervalFn: (fn: () => void, ms: number) => unknown;
  private readonly clearIntervalFn: (id: unknown) => void;

  constructor(events: BackingEvent[], private synth: Synth, private clock: GameClock, opts: SchedulerOptions = {}) {
    this.intervalMs = opts.intervalMs ?? 25;
    this.lookahead = opts.lookaheadSeconds ?? 0.12;
    this.muted = opts.mutedParts ?? new Set();
    this.drums = new Set([CLICK_CHANNEL, ...(opts.drumChannels ?? [])]);
    this.setIntervalFn = opts.setIntervalFn ?? ((fn, ms) => setInterval(fn, ms));
    this.clearIntervalFn = opts.clearIntervalFn ?? ((id) => clearInterval(id as number));
    this.events = opts.countIn ? [...countInEvents(opts.countIn), ...events] : events;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** Position the cursor at the first event at or after the clock's current song time. */
  reset(): void {
    const now = this.clock.now();
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid]!.time < now) lo = mid + 1;
      else hi = mid;
    }
    this.cursor = lo;
    // Program changes and controllers before `now` still matter: replay the latest per channel.
    const seenProgram = new Set<number>();
    for (let i = lo - 1; i >= 0; i--) {
      const e = this.events[i]!;
      if (e.type === 'program' && !seenProgram.has(e.channel)) {
        seenProgram.add(e.channel);
        this.synth.program(e.channel, e.value);
      }
    }
  }

  /**
   * Start scheduling from the clock's current song time. `resound`: notes of the band that were
   * already sounding at that time (struck before it, ending after it) are struck again now, so a
   * band that was stopped mid-note, as wait mode does, picks up with its notes instead of silence.
   */
  start(opts: { resound?: boolean } = {}): void {
    if (this.timer !== null) return;
    this.reset();
    if (opts.resound) this.resound();
    this.tick();
    this.timer = this.setIntervalFn(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      this.clearIntervalFn(this.timer);
      this.timer = null;
    }
    this.synth.allNotesOff(0);
  }

  /**
   * Strike again the notes that are on at the cursor: on before it, and either their off not yet
   * reached or held past it by the sustain pedal (CC64), which is still down at the cursor.
   * CC120/123 end what the synth would have ended.
   */
  private resound(): void {
    const open = new Map<string, { e: BackingEvent }>();
    const held = new Set<string>(); // keys released while the pedal was down
    const pedal = new Set<number>(); // channels with the pedal down
    const close = (channel: number, keep: (key: string) => boolean) => {
      for (const [k, o] of open) if (o.e.channel === channel && !keep(k)) { open.delete(k); held.delete(k); }
    };
    for (let i = 0; i < this.cursor; i++) {
      const e = this.events[i]!;
      if (e.type === 'cc') {
        if (e.controller === 64 && e.value >= 64) pedal.add(e.channel);
        else if ((e.controller === 64 && e.value < 64) || e.controller === 121) {
          pedal.delete(e.channel);
          close(e.channel, (k) => !held.has(k));
        } else if (e.controller === 120 || e.controller === 123) close(e.channel, (k) => held.has(k)); // as the synth: pedal-held notes stay
        continue;
      }
      if (e.type !== 'on' && e.type !== 'off') continue;
      const key = `${e.partKey}/${e.channel}/${e.pitch}`;
      if (e.type === 'on') {
        open.set(key, { e });
        held.delete(key);
      } else if (pedal.has(e.channel) && open.has(key)) held.add(key);
      else open.delete(key);
    }
    if (open.size === 0) return;
    const when = this.clock.songTimeToContextTime(this.clock.now());
    for (const ch of pedal) this.synth.control(ch, 64, 127, when);
    for (const [key, { e }] of open) {
      // a drum hit is over long before its note-off, and a count-in click is never struck twice
      if (this.drums.has(e.channel) || e.partKey === 'count-in' || this.muted.has(e.partKey)) continue;
      this.synth.noteOn(e.channel, e.pitch, e.velocity, when);
      // its key is already up: hand it to the pedal, so the pedal's release ends it
      if (held.has(key)) this.synth.noteOff(e.channel, e.pitch, when);
    }
  }

  /** Schedule everything due within the lookahead window. Public for tests. */
  tick(): void {
    if (!this.clock.playing) return;
    const horizon = this.clock.now() + this.lookahead * this.clock.rate;
    while (this.cursor < this.events.length) {
      const e = this.events[this.cursor]!;
      if (e.time > horizon) break;
      this.cursor++;
      const when = this.clock.songTimeToContextTime(e.time);
      switch (e.type) {
        case 'on':
          if (!this.muted.has(e.partKey)) this.synth.noteOn(e.channel, e.pitch, e.velocity, when);
          break;
        case 'off':
          if (!this.muted.has(e.partKey)) this.synth.noteOff(e.channel, e.pitch, when);
          break;
        case 'program':
          this.synth.program(e.channel, e.value);
          break;
        case 'cc':
          this.synth.control(e.channel, e.controller, e.value, when);
          break;
        case 'bend':
          this.synth.bend(e.channel, e.value, when);
          break;
        default:
          break;
      }
    }
  }
}

export function countInEvents(c: { beats: number; beatSeconds: number }): BackingEvent[] {
  const out: BackingEvent[] = [];
  for (let i = 0; i < c.beats; i++) {
    const time = -(c.beats - i) * c.beatSeconds;
    const pitch = i === 0 ? CLICK_ACCENT : CLICK_PITCH;
    const b = { track: -1, channel: CLICK_CHANNEL, partKey: 'count-in', controller: -1, value: 0 };
    out.push({ time, type: 'on', pitch, velocity: i === 0 ? 110 : 80, ...b });
    out.push({ time: time + 0.05, type: 'off', pitch, velocity: 0, ...b });
  }
  return out;
}
