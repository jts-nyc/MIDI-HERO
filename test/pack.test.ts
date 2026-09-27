import { describe, expect, it } from 'vitest';
import { buildPack, decodeBase64, encodeBase64, parsePackJson, validatePack } from '../src/midi/pack.ts';
import { end, off, on, smf } from './helpers/smf.ts';

const bytesA = smf([[on(0, 60), off(480, 60), end(480)]]);
const bytesB = smf([[on(0, 64), off(480, 64), end(480)]]);

describe('song pack', () => {
  it('round-trips through JSON', async () => {
    const pack = await buildPack('Class A', { kb: 25, timing: 'relaxed' }, [
      { title: 'A', bytes: bytesA, defaultParts: [{ track: 0, channel: 0 }] },
      { title: 'B', bytes: bytesB, defaultParts: [{ track: 0, channel: 0 }], split: 60, timingPreset: 'normal' },
    ]);
    expect(pack.songs[0]!.id).toMatch(/^[0-9a-f]{64}$/);
    const v = parsePackJson(JSON.stringify(pack));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.pack.name).toBe('Class A');
    expect(v.pack.settings).toEqual({ kb: 25, timing: 'relaxed', unlocks: false });
    expect(v.songs[1]!.bytes).toEqual(bytesB);
    expect(v.pack.songs[1]).toMatchObject({ split: 60, timingPreset: 'normal' });
  });

  it('carries the unlocks choice through a round trip; an old pack without it reads as false', async () => {
    const pack = await buildPack('Setlist', { kb: 25, unlocks: true }, [{ title: 'A', bytes: bytesA, defaultParts: [] }]);
    const v = parsePackJson(JSON.stringify(pack));
    expect(v.ok && v.pack.settings.unlocks).toBe(true);
    const old = validatePack({ format: 'midihero-pack', version: 1, settings: { kb: 49 }, songs: [{ title: 'A', midiBase64: encodeBase64(bytesA) }] });
    expect(old.ok && old.pack.settings).toEqual({ kb: 49, unlocks: false });
    const odd = validatePack({ format: 'midihero-pack', version: 1, settings: { unlocks: 'yes' }, songs: [{ title: 'A', midiBase64: encodeBase64(bytesA) }] });
    expect(odd.ok && odd.pack.settings.unlocks).toBe(false);
  });

  it('base64 helpers round-trip and reject garbage', () => {
    expect(decodeBase64(encodeBase64(bytesA))).toEqual(bytesA);
    expect(() => decodeBase64('not base64!')).toThrow();
  });

  it('rejects a different major version', () => {
    const v = validatePack({ format: 'midihero-pack', version: 2, songs: [{ title: 'x', midiBase64: encodeBase64(bytesA) }] });
    expect(v).toMatchObject({ ok: false });
    if (!v.ok) expect(v.error).toMatch(/version 2/);
  });

  it('rejects the whole pack when one song is bad, naming it', () => {
    const good = { title: 'Good', midiBase64: encodeBase64(bytesA), defaultParts: [] };
    const corrupt = validatePack({ format: 'midihero-pack', version: 1, songs: [good, { title: 'Broken', midiBase64: '###' }] });
    expect(corrupt).toMatchObject({ ok: false, error: expect.stringContaining('Broken') });
    const notMidi = validatePack({ format: 'midihero-pack', version: 1, songs: [good, { title: 'Text', midiBase64: encodeBase64(new TextEncoder().encode('hello')) }] });
    expect(notMidi).toMatchObject({ ok: false, error: expect.stringContaining('Text') });
  });

  it('rejects oversize packs and non-packs', () => {
    expect(validatePack({ format: 'midihero-pack', version: 1, songs: [] }, 11 * 1024 * 1024)).toMatchObject({ ok: false, error: expect.stringContaining('too large') });
    expect(validatePack({ hello: 1 })).toMatchObject({ ok: false });
    expect(parsePackJson('{oops')).toMatchObject({ ok: false });
  });

  it('accepts the bundled beginner pack', async () => {
    const { readFileSync } = await import('node:fs');
    const v = parsePackJson(readFileSync('public/packs/beginner.midihero.json', 'utf8'));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.pack.songs.length).toBe(4);
  });
});
