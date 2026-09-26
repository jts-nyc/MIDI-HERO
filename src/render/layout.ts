import type { PitchWindow } from '../midi/chart.ts';

export const isBlackKey = (pitch: number): boolean => [1, 3, 6, 8, 10].includes(((pitch % 12) + 12) % 12);
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const noteName = (pitch: number): string => `${NOTE_NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;

export interface KeyColumn {
  pitch: number;
  x: number;
  w: number;
  isBlack: boolean;
}

export interface KeyboardLayout {
  low: number;
  high: number;
  columns: Map<number, KeyColumn>;
  whiteWidth: number;
}

/** Display range: snapped outward to C boundaries, at least `minSpan` semitones, within MIDI 0..127. */
export function displayRange(minPitch: number, maxPitch: number, window: PitchWindow | null, minSpan = 24): PitchWindow {
  let low = window ? Math.min(window.low, minPitch) : minPitch;
  let high = window ? Math.max(window.high, maxPitch) : maxPitch;
  low = Math.floor(low / 12) * 12;
  high = Math.ceil(high / 12) * 12;
  while (high - low < minSpan) {
    if (low >= 12) low -= 12;
    else if (high <= 115) high += 12;
    else break;
  }
  return { low: Math.max(0, low), high: Math.min(127, high) };
}

export function layoutKeys(low: number, high: number, width: number): KeyboardLayout {
  const whites: number[] = [];
  for (let p = low; p <= high; p++) if (!isBlackKey(p)) whites.push(p);
  const whiteWidth = width / Math.max(1, whites.length);
  const columns = new Map<number, KeyColumn>();
  whites.forEach((p, i) => columns.set(p, { pitch: p, x: i * whiteWidth, w: whiteWidth, isBlack: false }));
  const blackW = whiteWidth * 0.6;
  for (let p = low; p <= high; p++) {
    if (!isBlackKey(p)) continue;
    const leftWhite = columns.get(p - 1);
    const boundary = leftWhite ? leftWhite.x + leftWhite.w : 0;
    columns.set(p, { pitch: p, x: boundary - blackW / 2, w: blackW, isBlack: true });
  }
  return { low, high, columns, whiteWidth };
}
