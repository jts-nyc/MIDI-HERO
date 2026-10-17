/**
 * Timing guides: an optional layer, shared by both highways, that makes the moment a note is to
 * be played easier to see (docs/research/highway-legibility.md). Off by default, so it can be
 * compared with the plain highway in class.
 *
 * - The grid is locked to the music: beat and bar lines are drawn stronger, and the perspective
 *   highway does not sway on bar lines.
 * - A strike zone on the hit line: a bright band as deep as the Perfect window and a faint one
 *   as deep as the Good window, so the timing allowance is visible.
 * - Landing pads: each lane's pad on the hit line lights up as a note comes in and is brightest
 *   at the instant the note is due; a note that is due but not played yet sits on the line
 *   instead of sliding under the keys.
 * - Early/late: a small tag over the key after every hit outside Perfect, and a timing meter that
 *   shows where the last hits fell.
 *
 * The pure helpers are exported for the tests; `TimingGuides` draws and allocates nothing per frame.
 */

/** One hit, for the early/late tag and the timing meter. */
export interface TimingMark {
  pitch: number;
  /** press time minus note time, song seconds: negative is early */
  delta: number;
  /** song time of the hit */
  time: number;
}

/** What the session hands the renderer when the guides are on. Windows are half-widths in song seconds. */
export interface GuideState {
  perfect: number;
  great: number;
  good: number;
  miss: number;
  /** recent hits, oldest first, at most GUIDES.marks */
  marks: TimingMark[];
}

export const GUIDES = {
  /** a lane's pad starts to light this long (s, song time) before its note is due */
  lead: 0.4,
  /** and goes dark this long after it */
  fall: 0.12,
  /** hits kept for the meter */
  marks: 12,
  /** seconds a tick stays on the meter, and an early/late tag over its key */
  markLife: 3,
  tagLife: 0.6,
  /** beat and bar lines with the guides on: alpha of a beat, of a bar; bar width px */
  beatAlpha: 0.16,
  barAlpha: 0.42,
  barWidth: 3,
} as const;

export const EARLY_COLOR = '#7fd1ff';
export const LATE_COLOR = '#ffa95c';

/**
 * How lit a lane's pad is when its note is `dt` seconds away (positive: still to come):
 * 0 until `lead`, rising to 1 exactly when the note is due, then gone over `fall`.
 */
export function approach(dt: number, lead: number = GUIDES.lead, fall: number = GUIDES.fall): number {
  if (dt > lead || dt < -fall) return 0;
  if (dt >= 0) {
    const k = 1 - dt / lead;
    return k * k;
  }
  return 1 + dt / fall;
}

/** 'early' or 'late' for a hit outside the Perfect window; null for Perfect. */
export function timingSide(delta: number, perfect: number): 'early' | 'late' | null {
  if (Math.abs(delta) <= perfect) return null;
  return delta < 0 ? 'early' : 'late';
}

/** Offset of a hit on the meter, -1 (as early as can be hit) .. 1 (as late), for a meter `miss` wide each way. */
export function meterPosition(delta: number, miss: number): number {
  if (!(miss > 0)) return 0;
  return Math.max(-1, Math.min(1, delta / miss));
}

/**
 * Bottom row of a note that is due: it sits on the hit line until it is played or missed,
 * instead of sliding under the keys. `y` is where the note's onset would be drawn.
 */
export function landedRow(y: number, hitY: number, pending: boolean): number {
  return pending && y > hitY ? hitY : y;
}

/** Keep the last GUIDES.marks hits, in place. */
export function pushMark(marks: TimingMark[], mark: TimingMark): void {
  marks.push(mark);
  if (marks.length > GUIDES.marks) marks.splice(0, marks.length - GUIDES.marks);
}

/** Lane colour of a pad, by hand: [right, left]. */
const PAD_COLOR = ['rgb(79,140,255)', 'rgb(255,159,67)'];

export class TimingGuides {
  /** pad light per pitch this frame, 0..1, and the hand of the note that lit it (0 right, 1 left) */
  private pads = new Float32Array(128);
  private hands = new Uint8Array(128);
  private lit: number[] = [];

  /** Start a frame: every pad dark. */
  begin(): void {
    for (let i = 0; i < this.lit.length; i++) this.pads[this.lit[i]!] = 0;
    this.lit.length = 0;
  }

  /** A pending note `dt` seconds from due lights its lane's pad. */
  note(pitch: number, dt: number, left: boolean): void {
    if (pitch < 0 || pitch > 127) return;
    const a = approach(dt);
    if (a <= this.pads[pitch]!) return;
    if (this.pads[pitch] === 0) this.lit.push(pitch);
    this.pads[pitch] = a;
    this.hands[pitch] = left ? 1 : 0;
  }

  /** Light of a pad this frame, for the tests. */
  pad(pitch: number): number {
    return this.pads[pitch] ?? 0;
  }

  /**
   * The strike zone above the hit line: a faint band as deep as the early half of the Good
   * window and a brighter one as deep as Perfect's. (The late half is under the keys; there a
   * due note sits on the line until its window closes.) `rowOf(dt)` is the screen row of an
   * event `dt` seconds away; `rowOf(0)` is the hit line.
   */
  drawZone(ctx: CanvasRenderingContext2D, g: GuideState, width: number, rowOf: (dt: number) => number): void {
    const hitY = rowOf(0);
    const goodTop = rowOf(g.good);
    const perfectTop = rowOf(g.perfect);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.06;
    ctx.fillRect(0, goodTop, width, hitY - goodTop);
    ctx.globalAlpha = 0.12;
    ctx.fillRect(0, perfectTop, width, hitY - perfectTop);
    // the early edge of the Good window: from here the note can be played
    ctx.globalAlpha = 0.35;
    ctx.fillRect(0, Math.round(goodTop), width, 1);
    ctx.globalAlpha = 1;
  }

  /**
   * Landing pads: a bracket over each lit lane on the hit line, brightest when its note is due.
   * `col(pitch)` is the lane at the hit line.
   */
  drawPads(ctx: CanvasRenderingContext2D, col: (pitch: number) => { x: number; w: number } | undefined, hitY: number): void {
    for (let i = 0; i < this.lit.length; i++) {
      const pitch = this.lit[i]!;
      const a = this.pads[pitch]!;
      const c = col(pitch);
      if (!c || a <= 0) continue;
      ctx.globalAlpha = 0.25 + 0.75 * a;
      ctx.fillStyle = PAD_COLOR[this.hands[pitch]!]!;
      const h = 3 + 4 * a;
      ctx.fillRect(c.x + 1, hitY - h, Math.max(1, c.w - 2), h);
      if (a > 0.85) {
        // the instant it is due: the pad turns white
        ctx.globalAlpha = (a - 0.85) / 0.15;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(c.x + 1, hitY - h, Math.max(1, c.w - 2), h);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** "early" or "late" over the key of each recent hit outside Perfect. */
  drawTags(ctx: CanvasRenderingContext2D, g: GuideState, time: number, xOf: (pitch: number) => number | undefined, hitY: number): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px system-ui';
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 3;
    for (let i = 0; i < g.marks.length; i++) {
      const m = g.marks[i]!;
      const age = time - m.time;
      if (age < 0 || age > GUIDES.tagLife) continue;
      const side = timingSide(m.delta, g.perfect);
      const x = xOf(m.pitch);
      if (!side || x === undefined) continue;
      const text = side === 'early' ? '◂ EARLY' : 'LATE ▸';
      ctx.globalAlpha = 1 - age / GUIDES.tagLife;
      // outlined, so it reads over a lit note or a held trail
      ctx.strokeText(text, x, hitY - 20);
      ctx.fillStyle = side === 'early' ? EARLY_COLOR : LATE_COLOR;
      ctx.fillText(text, x, hitY - 20);
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
  }

  /**
   * Timing meter at the top centre, under the Pause button: the Perfect, Great and Good windows
   * as bands, a tick for each recent hit (left early, right late), fading with age.
   */
  drawMeter(ctx: CanvasRenderingContext2D, g: GuideState, time: number, width: number): void {
    const half = Math.min(130, width * 0.16);
    const cx = width / 2;
    const y = 50;
    const h = 8;
    const at = (d: number) => cx + meterPosition(d, g.miss) * half;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(cx - half, y, half * 2, h);
    ctx.fillStyle = 'rgba(255,209,102,0.35)';
    ctx.fillRect(at(-g.good), y, at(g.good) - at(-g.good), h);
    ctx.fillStyle = 'rgba(79,140,255,0.45)';
    ctx.fillRect(at(-g.great), y, at(g.great) - at(-g.great), h);
    ctx.fillStyle = 'rgba(61,220,132,0.6)';
    ctx.fillRect(at(-g.perfect), y, at(g.perfect) - at(-g.perfect), h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 0.5, y - 3, 1, h + 6);
    for (let i = 0; i < g.marks.length; i++) {
      const m = g.marks[i]!;
      const age = time - m.time;
      if (age < 0 || age > GUIDES.markLife) continue;
      ctx.globalAlpha = 1 - age / GUIDES.markLife;
      const side = timingSide(m.delta, g.perfect);
      ctx.fillStyle = side === 'early' ? EARLY_COLOR : side === 'late' ? LATE_COLOR : '#ffffff';
      ctx.fillRect(Math.round(at(m.delta)) - 1, y - 4, 2, h + 8);
    }
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#9aa0b4';
    ctx.font = '10px system-ui';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'right';
    ctx.fillText('early', cx - half - 6, y - 1);
    ctx.textAlign = 'left';
    ctx.fillText('late', cx + half + 6, y - 1);
    ctx.globalAlpha = 1;
  }
}
