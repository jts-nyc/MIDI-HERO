/** HiDPI-aware canvas sizing. Draw in CSS pixels; the transform handles the rest. */

export interface CanvasSize {
  width: number; // CSS px
  height: number; // CSS px
  dpr: number;
}

export const MAX_DPR = 2;

export function fitCanvas(canvas: HTMLCanvasElement): CanvasSize {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  const pw = Math.round(width * dpr);
  const ph = Math.round(height * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height, dpr };
}
