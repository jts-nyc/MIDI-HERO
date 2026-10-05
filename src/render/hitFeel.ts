/**
 * Drawing for the feel layer, shared by both highways: light columns and key flashes on hits,
 * timing words that snap in, the hit line's beat pulse, the charge light that grows with the
 * multiplier, the flare on milestones, and star power's rails. The flat highway passes an
 * identity projection; the perspective one passes its own, so a column narrows up the lane.
 *
 * Gradients are built once per size and tint (vertical gradients do not depend on x, so one
 * serves every lane); nothing is allocated per frame.
 */
import { FEEL, beatPulse, chargeAlpha, countPulse, popupPose, type PopupPose } from './feel.ts';
import type { FxState } from './fx.ts';
import type { Popup } from './renderer.ts';
import type { BeatLine } from '../midi/parse.ts';

/** RGB of each effect tint, indexed by TintId (same order as fx.ts Tint). */
export const TINT_RGB: readonly string[] = ['61,220,132', '79,140,255', '255,209,102', '154,160,180', '255,92,92', '255,210,63'];
/** Multiplier colours 1×..4× (theme.multiplier) as RGB, then star gold. */
const CHARGE_RGB: readonly string[] = ['154,160,180', '255,209,102', '61,220,132', '199,125,255', '255,210,63'];

const POPUP_FONTS = { perfect: `bold ${FEEL.popupSize.perfect}px system-ui`, other: `bold ${FEEL.popupSize.other}px system-ui` };

export type XAt = (x: number, y: number) => number;
const flatX: XAt = (x) => x;

export class HitFeel {
  private beamGradients: CanvasGradient[] = [];
  private chargeGradients: CanvasGradient[] = [];
  private surgeGradients: CanvasGradient[] = [];
  private hitY = -1;
  private width = -1;
  private pose: PopupPose = { scale: 1, alpha: 1, rise: 0 };
  /** hit-line pulse this frame, 0..1 (beats, bars and the count-in) */
  pulse = 0;

  /** Build the gradients for a canvas size. Call from a renderer's layout step. */
  cache(ctx: CanvasRenderingContext2D, width: number, hitY: number): void {
    if (hitY === this.hitY && width === this.width) return;
    this.hitY = hitY;
    this.width = width;
    const reach = hitY * FEEL.beamReach;
    this.beamGradients = TINT_RGB.map((rgb) => {
      const g = ctx.createLinearGradient(0, hitY, 0, hitY - reach);
      g.addColorStop(0, `rgba(${rgb},0.55)`);
      g.addColorStop(0.35, `rgba(${rgb},0.22)`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      return g;
    });
    this.chargeGradients = CHARGE_RGB.map((rgb) => {
      const g = ctx.createLinearGradient(0, hitY, 0, hitY - FEEL.chargeHeight);
      g.addColorStop(0, `rgba(${rgb},1)`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      return g;
    });
    this.surgeGradients = TINT_RGB.map((rgb) => {
      const g = ctx.createLinearGradient(0, hitY, 0, hitY - FEEL.chargeHeight * 2.5);
      g.addColorStop(0, `rgba(${rgb},0.85)`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      return g;
    });
  }

  /** Work out this frame's hit-line pulse from the beat lines (from cursor `from`) and the count-in. */
  update(fx: FxState, lines: readonly BeatLine[], from: number, time: number, still: boolean): void {
    if (still) {
      this.pulse = 0;
      return;
    }
    const count = fx.countdown.value > 0 ? countPulse(fx.countdown.phase) : 0;
    this.pulse = Math.max(count, beatPulse(lines, from, time));
  }

  /**
   * Columns of light up the lanes of keys just hit. `col(pitch)` gives the lane's left edge and
   * width at the hit line; `xAt` projects an x at a row (identity on the flat highway).
   */
  drawBeams(ctx: CanvasRenderingContext2D, fx: FxState, col: (pitch: number) => { x: number; w: number } | undefined, hitY: number, xAt: XAt = flatX): void {
    const beams = fx.beams;
    const top = hitY - hitY * FEEL.beamReach;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i]!;
      if (!b.active) continue;
      const c = col(b.pitch);
      if (!c) continue;
      const t = b.age / b.life;
      ctx.globalAlpha = Math.min(1, b.strength * (1 - t) * (1 - t));
      ctx.fillStyle = this.beamGradients[b.tint]!;
      // the column narrows a little as it fades, like a light going out
      const inset = c.w * 0.18 * t;
      const l = c.x + inset;
      const r = c.x + c.w - inset;
      ctx.beginPath();
      ctx.moveTo(xAt(l, top), top);
      ctx.lineTo(xAt(r, top), top);
      ctx.lineTo(r, hitY);
      ctx.lineTo(l, hitY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /** The white flash on each key in the first moment of its hit, 0..1 per pitch, into `out`. */
  keyFlashes(fx: FxState, out: Float32Array): void {
    out.fill(0);
    const beams = fx.beams;
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i]!;
      if (!b.active || b.age >= FEEL.keyFlash || b.pitch < 0 || b.pitch >= out.length) continue;
      out[b.pitch] = Math.max(out[b.pitch]!, (1 - b.age / FEEL.keyFlash) * Math.min(1, b.strength + 0.2));
    }
  }

  /**
   * The light above the hit line: brighter with each multiplier level and in star power, and it
   * swells on the beat. Then the flare of a milestone, level-up or star power on top.
   */
  drawCharge(ctx: CanvasRenderingContext2D, fx: FxState, width: number, hitY: number): void {
    const m = fx.meters;
    const base = chargeAlpha(m.multiplier, m.starActive);
    const alpha = base * (1 + 0.6 * this.pulse) + 0.05 * this.pulse;
    if (alpha > 0.005) {
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.fillStyle = this.chargeGradients[m.starActive ? 4 : Math.max(0, Math.min(3, m.multiplier - 1))]!;
      ctx.fillRect(0, hitY - FEEL.chargeHeight, width, FEEL.chargeHeight);
    }
    const s = fx.surge;
    if (s.life > 0) {
      const t = s.age / s.life;
      ctx.globalAlpha = (1 - t) * (1 - t);
      ctx.fillStyle = this.surgeGradients[s.tint]!;
      const h = FEEL.chargeHeight * 2.5 * (0.5 + 0.5 * t);
      ctx.fillRect(0, hitY - h, width, h);
    }
    ctx.globalAlpha = 1;
  }

  /** The hit line itself brightens and thickens on the beat. */
  drawLinePulse(ctx: CanvasRenderingContext2D, width: number, hitY: number, color: string): void {
    if (this.pulse <= 0.01) return;
    ctx.globalAlpha = 0.5 * this.pulse;
    ctx.fillStyle = color;
    const h = 2 + 3 * this.pulse;
    ctx.fillRect(0, hitY - 1 - h, width, h);
    ctx.globalAlpha = 1;
  }

  /** Star power: gold rails along both edges of the highway, pulsing with the beat. */
  drawRails(ctx: CanvasRenderingContext2D, width: number, hitY: number, xAt: XAt = flatX): void {
    ctx.globalAlpha = 0.45 + 0.5 * this.pulse;
    ctx.strokeStyle = 'rgb(255,210,63)';
    ctx.lineWidth = 3 + 2 * this.pulse;
    ctx.beginPath();
    ctx.moveTo(xAt(1.5, 0), 0);
    ctx.lineTo(1.5, hitY);
    ctx.moveTo(xAt(width - 1.5, 0), 0);
    ctx.lineTo(width - 1.5, hitY);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
  }

  /**
   * Timing words: each snaps in large and settles, drifts up and fades (feel.ts popupPose).
   * "Perfect" is bigger than the rest. `superseded(i)` says a newer word nearby replaces it.
   */
  drawPopups(ctx: CanvasRenderingContext2D, popups: readonly Popup[], time: number, xOf: (pitch: number) => number | undefined,
    hitY: number, still: boolean, superseded: (i: number) => boolean): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    for (let i = 0; i < popups.length; i++) {
      const p = popups[i]!;
      const age = time - p.time;
      if (age < 0 || age > FEEL.popup.life) continue;
      const x = xOf(p.pitch);
      if (x === undefined || superseded(i)) continue;
      const pose = popupPose(age, this.pose, still);
      ctx.font = p.text === 'Perfect' ? POPUP_FONTS.perfect : POPUP_FONTS.other;
      ctx.globalAlpha = pose.alpha;
      ctx.fillStyle = p.color;
      const y = hitY - 42 - pose.rise;
      if (pose.scale !== 1) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(pose.scale, pose.scale);
        ctx.strokeText(p.text, 0, 0);
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
      } else {
        ctx.strokeText(p.text, x, y);
        ctx.fillText(p.text, x, y);
      }
    }
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
  }
}
