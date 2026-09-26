/** Pure input normalisation: raw MIDI bytes → InputEvents, channel policy, merging, octave tracking. */

export type InputSource = 'midi' | 'keyboard' | 'autoplay';

export interface InputEvent {
  type: 'on' | 'off' | 'pedal';
  pitch: number;
  velocity: number;
  channel: number;
  /** performance-timeline timestamp in ms */
  perfMs: number;
  source: InputSource;
}

export interface RawMessage {
  data: ArrayLike<number>;
  perfMs: number;
}

/** Parse one raw MIDI message. Returns null for anything the game ignores. */
export function parseMessage(raw: RawMessage, source: InputSource = 'midi'): InputEvent | null {
  const d = raw.data;
  if (d.length === 0) return null;
  const status = d[0]!;
  if (status >= 0xf8) return null; // system realtime (clock, active sensing)
  if (status >= 0xf0) return null; // system common / sysex
  const type = status & 0xf0;
  const channel = status & 0x0f;
  if (type === 0x90) {
    const velocity = d[2] ?? 0;
    return { type: velocity === 0 ? 'off' : 'on', pitch: d[1] ?? 0, velocity, channel, perfMs: raw.perfMs, source };
  }
  if (type === 0x80) return { type: 'off', pitch: d[1] ?? 0, velocity: d[2] ?? 0, channel, perfMs: raw.perfMs, source };
  if (type === 0xb0 && d[1] === 64) return { type: 'pedal', pitch: -1, velocity: d[2] ?? 0, channel, perfMs: raw.perfMs, source };
  return null; // aftertouch, other CCs, program, bend
}

export interface ChannelPolicyOptions {
  /** merge same-pitch note-ons within this many ms, across channels */
  mergeMs?: number;
}

/**
 * Channel policy: before a lock, accept every channel except 9 (drums/pads);
 * after `lock(channel)`, accept that channel only. Always merges doubled
 * note-ons (e.g. a keyboard's Dual voice sending two channels).
 */
export class ChannelFilter {
  locked: number | null = null;
  private readonly mergeMs: number;
  private lastOn = new Map<number, number>();

  constructor(opts: ChannelPolicyOptions = {}) {
    this.mergeMs = opts.mergeMs ?? 15;
  }

  lock(channel: number): void {
    this.locked = channel;
  }

  reset(): void {
    this.locked = null;
    this.lastOn.clear();
  }

  /** Returns the event if it passes, else null. */
  filter(ev: InputEvent): InputEvent | null {
    if (ev.source !== 'midi') return ev;
    if (ev.type === 'pedal') return ev;
    if (this.locked === null ? ev.channel === 9 : ev.channel !== this.locked) return null;
    if (ev.type === 'on') {
      const last = this.lastOn.get(ev.pitch);
      if (last !== undefined && ev.perfMs - last < this.mergeMs) return null;
      this.lastOn.set(ev.pitch, ev.perfMs);
    }
    return ev;
  }
}

export type OctaveEvent = { type: 'reoffset'; delta: number } | { type: 'transposed'; delta: number };

/**
 * Tracks presses that are consistently off from the chart by an octave (or a
 * transposition). After `k` presses in a row with the same delta it reports:
 * a multiple of 12 → 'reoffset' (the player bumped the octave button);
 * anything else → 'transposed' (the keyboard is transposed; re-run the gate).
 */
export class OctaveTracker {
  private streakDelta = 0;
  private streak = 0;

  constructor(private readonly k = 3) {}

  /**
   * @param matched true when the press hit a chart note
   * @param delta   pending chart pitch minus played pitch when it did not match (0 if nothing was pending)
   */
  observe(matched: boolean, delta: number): OctaveEvent | null {
    if (matched || delta === 0) {
      this.streak = 0;
      return null;
    }
    if (delta === this.streakDelta) this.streak++;
    else {
      this.streakDelta = delta;
      this.streak = 1;
    }
    if (this.streak >= this.k) {
      this.streak = 0;
      return delta % 12 === 0 ? { type: 'reoffset', delta } : { type: 'transposed', delta };
    }
    return null;
  }

  reset(): void {
    this.streak = 0;
  }
}
