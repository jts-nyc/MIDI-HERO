import { describe, expect, it } from 'vitest';
import { supersededPopup, type Popup } from '../src/render/renderer.ts';

const pop = (pitch: number, time: number): Popup => ({ pitch, time, text: 'Perfect', color: '#fff' });
const xOf = (pitch: number) => (pitch - 60) * 20;

describe('judgment popups', () => {
  it('an older label gives way to a newer one nearby, so fast runs stay readable', () => {
    const ps = [pop(64, 1), pop(63, 1.1)];
    expect(supersededPopup(ps, 0, xOf, 1.2)).toBe(true);
    expect(supersededPopup(ps, 1, xOf, 1.2)).toBe(false);
  });

  it('labels far apart, or a newer one not yet due, both stay', () => {
    expect(supersededPopup([pop(60, 1), pop(72, 1.1)], 0, xOf, 1.2)).toBe(false);
    expect(supersededPopup([pop(64, 1), pop(63, 1.5)], 0, xOf, 1.2)).toBe(false);
  });
});
