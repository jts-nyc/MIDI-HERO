import { afterEach, describe, expect, it, vi } from 'vitest';
import { MidiInput } from '../src/input/midiInput.ts';
import { hasKeyboard, needsKeyboardBanner, updateKeyboardBanner } from '../src/ui/keyboardBanner.ts';
import { FakeAccess, stubMidi } from './helpers/fakeMidi.ts';

afterEach(() => vi.unstubAllGlobals());

/** As both pages wire it: on every change, pick a port again and update the banner. */
async function page(access: FakeAccess | null) {
  stubMidi(access);
  const midi = new MidiInput();
  const events: number[] = [];
  midi.onEvent = (ev) => events.push(ev.pitch);
  midi.onChange = () => midi.autoSelect(null);
  const status = await midi.request();
  if (status === 'granted') midi.autoSelect(null);
  return { midi, events, status };
}

describe('hasKeyboard', () => {
  it('does not count software ports or unplugged keyboards', () => {
    expect(hasKeyboard([])).toBe(false);
    expect(hasKeyboard([{ id: 't', name: 'Midi Through Port-0', state: 'connected' }])).toBe(false);
    expect(hasKeyboard([{ id: 'k', name: 'Oxygen 25', state: 'disconnected' }])).toBe(false);
    expect(hasKeyboard([{ id: 't', name: 'Midi Through Port-0', state: 'connected' }, { id: 'k', name: 'Oxygen 25', state: 'connected' }])).toBe(true);
  });
});

describe('keyboard plugged in after the page loaded', () => {
  it('is picked up from the statechange, and the banner goes away', async () => {
    const access = new FakeAccess([]);
    const { midi, events, status } = await page(access);
    expect(status).toBe('granted');
    expect(midi.selectedId).toBeNull();
    expect(needsKeyboardBanner(midi)).toBe(true);

    const oxygen = access.plug('oxy', 'Oxygen 25');
    expect(midi.selectedId).toBe('oxy');
    expect(needsKeyboardBanner(midi)).toBe(false);
    oxygen.noteOn(60);
    expect(events).toEqual([60]);
  });

  it('shows the banner when only a through port is there', async () => {
    const { midi } = await page(new FakeAccess([['t', 'Midi Through Port-0']]));
    expect(needsKeyboardBanner(midi)).toBe(true);
  });

  it('keeps the banner while a through port is the selected one, even with a keyboard connected', () => {
    const ports = [{ id: 't', name: 'Midi Through Port-0', state: 'connected' }, { id: 'k', name: 'Oxygen 25', state: 'connected' }];
    expect(needsKeyboardBanner({ status: 'granted', selectedId: 't', listPorts: () => ports })).toBe(true);
    expect(needsKeyboardBanner({ status: 'granted', selectedId: null, listPorts: () => ports })).toBe(true);
    expect(needsKeyboardBanner({ status: 'granted', selectedId: 'k', listPorts: () => ports })).toBe(false);
  });

  it('shows the banner again after an unplug', async () => {
    const access = new FakeAccess([['oxy', 'Oxygen 25']]);
    const { midi } = await page(access);
    expect(needsKeyboardBanner(midi)).toBe(false);
    access.unplug('oxy');
    expect(needsKeyboardBanner(midi)).toBe(true);
  });

  it('does not ask to plug in a keyboard after the player chose computer keys', async () => {
    const { midi } = await page(new FakeAccess([['oxy', 'Oxygen 25']]));
    midi.useComputerKeys();
    expect(midi.selectedId).toBeNull();
    expect(needsKeyboardBanner(midi)).toBe(false);
  });

  it('no banner when MIDI is blocked or missing: those have their own message', async () => {
    const blocked = await page(null);
    expect(blocked.status).toBe('denied');
    expect(needsKeyboardBanner(blocked.midi)).toBe(false);
    vi.stubGlobal('navigator', {});
    const none = new MidiInput();
    expect(await none.request()).toBe('unsupported');
    expect(needsKeyboardBanner(none)).toBe(false);
  });

  it('updateKeyboardBanner reports the state without a DOM', async () => {
    const access = new FakeAccess([]);
    const { midi } = await page(access);
    vi.stubGlobal('document', undefined);
    expect(updateKeyboardBanner(midi)).toBe(false); // nothing to draw on, but no throw
    access.plug('oxy', 'Oxygen 25');
    expect(updateKeyboardBanner(midi)).toBe(false);
  });
});
