import { afterEach, describe, expect, it, vi } from 'vitest';
import { MidiInput, sortPorts, type PortStore, type RememberedPort } from '../src/input/midiInput.ts';
import { isVirtualPort } from '../src/input/ports.ts';
import { FakeAccess, stubMidi } from './helpers/fakeMidi.ts';

function memoryStore(initial: RememberedPort | null = null): PortStore & { value: RememberedPort | null } {
  return {
    value: initial,
    load() { return this.value; },
    save(p) { this.value = p; },
  };
}

/** What a Chromebook showed in class: the through port, then three Oxygen 25 ports. */
const CLASSROOM: [string, string][] = [
  ['through', 'Midi Through Port-0'],
  ['oxy1', 'Oxygen 25 MIDI 1'],
  ['oxy2', 'Oxygen 25 MIDI 2'],
  ['oxy3', 'Oxygen 25 MIDI 3'],
];

async function open(access: FakeAccess, store = memoryStore()) {
  stubMidi(access);
  const midi = new MidiInput(store);
  const events: { pitch: number; port: string }[] = [];
  midi.onEvent = (ev, port) => events.push({ pitch: ev.pitch, port });
  let changes = 0;
  midi.onChange = () => changes++;
  await midi.request();
  return { midi, events, store, changes: () => changes };
}

afterEach(() => vi.unstubAllGlobals());

describe('isVirtualPort', () => {
  it('knows the software ports of each system', () => {
    for (const n of ['Midi Through Port-0', 'MIDI THROUGH', 'IAC Driver Bus 1', 'loopMIDI Port', 'Thru Port']) expect(isVirtualPort(n), n).toBe(true);
    for (const n of ['Oxygen 25', 'Oxygen 25 MIDI 1', 'USB MIDI Interface', 'Digital Piano', 'Yamaha P-125', 'Keystation 49 MK3']) expect(isVirtualPort(n), n).toBe(false);
  });
});

describe('sortPorts', () => {
  it('puts virtual ports last and control ports after keyboards', () => {
    const ports = [...CLASSROOM, ['daw', 'MPK mini 3 DAW'] as [string, string]].map(([id, name]) => ({ id, name, state: 'connected' }));
    expect(sortPorts(ports).map((p) => p.id)).toEqual(['oxy1', 'oxy2', 'oxy3', 'daw', 'through']);
  });
});

describe('MidiInput port choice', () => {
  it('never picks the through port on its own', async () => {
    const { midi } = await open(new FakeAccess(CLASSROOM));
    expect(midi.autoSelect(null)).toBe('oxy1');
    const only = await open(new FakeAccess([['through', 'Midi Through Port-0']]));
    expect(only.midi.autoSelect(null)).toBeNull();
  });

  it('ignores an older saved setting that names the through port', async () => {
    const { midi } = await open(new FakeAccess(CLASSROOM));
    expect(midi.autoSelect('through')).toBe('oxy1');
    expect(midi.autoSelect('oxy2')).toBe('oxy2');
  });

  it('locks to the port that actually plays and remembers it', async () => {
    const access = new FakeAccess(CLASSROOM);
    const { midi, events, store, changes } = await open(access);
    midi.autoSelect(null);
    access.inputs.get('oxy2')!.noteOn(60);
    expect(midi.selectedId).toBe('oxy2');
    expect(events).toEqual([{ pitch: 60, port: 'oxy2' }]);
    expect(store.value).toEqual({ id: 'oxy2', name: 'Oxygen 25 MIDI 2' });
    expect(changes()).toBe(1);
    // Locked: another port's notes no longer get through, and a replug of another port keeps the lock.
    access.inputs.get('oxy1')!.noteOn(62);
    expect(events).toHaveLength(1);
    expect(midi.autoSelect(null)).toBe('oxy2');
  });

  it('does not let a virtual port take over', async () => {
    const access = new FakeAccess(CLASSROOM);
    const { midi, events } = await open(access);
    midi.autoSelect(null);
    access.inputs.get('through')!.noteOn(60); // closed: no handler was set
    expect(access.inputs.get('through')!.connection).toBe('closed');
    expect(events).toEqual([]);
    expect(midi.selectedId).toBe('oxy1');
  });

  it('starts from the remembered port next time, by id or by name', async () => {
    const byId = await open(new FakeAccess(CLASSROOM), memoryStore({ id: 'oxy3', name: 'Oxygen 25 MIDI 3' }));
    expect(byId.midi.autoSelect(null)).toBe('oxy3');
    const byName = await open(new FakeAccess([['t', 'Midi Through Port-0'], ['a', 'Oxygen 25 MIDI 1'], ['b', 'Oxygen 25 MIDI 2']]), memoryStore({ id: 'old', name: 'Oxygen 25 MIDI 2' }));
    expect(byName.midi.autoSelect(null)).toBe('b');
  });

  it('a port chosen in Settings is kept, even a virtual one', async () => {
    const access = new FakeAccess(CLASSROOM);
    const { midi, events, store } = await open(access);
    expect(midi.select('through')).toBe('through');
    expect(store.value?.id).toBe('through');
    access.inputs.get('oxy1')!.noteOn(60);
    expect(events).toEqual([]);
    access.inputs.get('through')!.noteOn(64);
    expect(events).toEqual([{ pitch: 64, port: 'through' }]);
    expect(midi.select(null)).toBe('through'); // back to automatic: the remembered choice comes first
  });

  it('opening ports is not reported as a keyboard coming or going', async () => {
    const access = new FakeAccess(CLASSROOM);
    const { midi, changes } = await open(access);
    midi.autoSelect(null);
    expect(changes()).toBe(0);
    access.unplug('oxy1');
    expect(changes()).toBe(1);
    expect(midi.autoSelect(null)).toBe('oxy2');
  });

  it('keeps a computer-key choice when a pending MIDI request resolves', async () => {
    const access = new FakeAccess(CLASSROOM);
    let resolvePermission!: (access: MIDIAccess) => void;
    const permission = new Promise<MIDIAccess>((resolve) => { resolvePermission = resolve; });
    vi.stubGlobal('navigator', { requestMIDIAccess: () => permission });
    const midi = new MidiInput(memoryStore());
    const received = vi.fn();
    midi.onEvent = received;
    const request = midi.request();
    midi.useComputerKeys();
    resolvePermission(access as unknown as MIDIAccess);
    expect(await request).toBe('granted');
    expect(midi.autoSelect('oxy1')).toBeNull();
    access.inputs.get('oxy2')!.noteOn(60);
    expect(received).not.toHaveBeenCalled();
  });

  it('stays on computer keys across hardware events until Settings selects MIDI again', async () => {
    const access = new FakeAccess(CLASSROOM);
    const { midi, events } = await open(access);
    midi.onChange = () => { midi.autoSelect(null); };
    midi.autoSelect(null);
    midi.useComputerKeys();
    expect(midi.selectedId).toBeNull();
    access.inputs.get('oxy1')!.noteOn(60);
    access.plug('new', 'Digital Piano').noteOn(64);
    expect(midi.selectedId).toBeNull();
    expect(events).toEqual([]);
    expect(midi.usingComputerKeys).toBe(true);
    expect(midi.select('oxy2')).toBe('oxy2');
    access.inputs.get('oxy2')!.noteOn(67);
    expect(midi.usingComputerKeys).toBe(false);
    expect(events).toEqual([{ pitch: 67, port: 'oxy2' }]);
  });
});
