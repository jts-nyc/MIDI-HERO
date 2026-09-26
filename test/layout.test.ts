import { describe, expect, it } from 'vitest';
import { displayRange, isBlackKey, layoutKeys, noteName } from '../src/render/layout.ts';

describe('layout', () => {
  it('names notes', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(61)).toBe('C#4');
    expect(noteName(21)).toBe('A0');
    expect(isBlackKey(61)).toBe(true);
    expect(isBlackKey(64)).toBe(false);
  });

  it('snaps the display range outward to C boundaries with a minimum span', () => {
    expect(displayRange(61, 63, null, 24)).toEqual({ low: 48, high: 72 });
    expect(displayRange(40, 90, null)).toEqual({ low: 36, high: 96 });
    expect(displayRange(0, 127, null)).toEqual({ low: 0, high: 127 });
  });

  it('includes the window when given', () => {
    expect(displayRange(64, 67, { low: 60, high: 84 })).toEqual({ low: 60, high: 84 });
  });

  it('spaces white keys evenly and centres black keys on boundaries', () => {
    const l = layoutKeys(60, 72, 800);
    // C4..C5 has 8 white keys
    expect(l.whiteWidth).toBe(100);
    expect(l.columns.get(60)).toMatchObject({ x: 0, w: 100, isBlack: false });
    expect(l.columns.get(62)).toMatchObject({ x: 100, w: 100 });
    const cs = l.columns.get(61)!;
    expect(cs.isBlack).toBe(true);
    expect(cs.w).toBe(60);
    expect(cs.x + cs.w / 2).toBe(100); // centred on the C/D boundary
    expect(l.columns.size).toBe(13);
  });
});
