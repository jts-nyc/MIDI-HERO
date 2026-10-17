import { parseMessage, type InputEvent } from './normalize.ts';
import { isVirtualPort } from './ports.ts';

export interface MidiPort {
  id: string;
  name: string;
  state: string;
}

export type MidiStatus = 'unsupported' | 'pending' | 'granted' | 'denied';

/** The port that last played a note or that the player chose, kept between visits. */
export interface RememberedPort {
  id: string;
  name: string;
}

export interface PortStore {
  load(): RememberedPort | null;
  save(port: RememberedPort): void;
}

const STORE_KEY = 'midihero.midiPort.v1';

/** localStorage, shared by the full game and simple mode; a blocked storage just forgets. */
export const localPortStore: PortStore = {
  load() {
    try {
      const r = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<RememberedPort> | null;
      return r && typeof r.id === 'string' && typeof r.name === 'string' ? { id: r.id, name: r.name } : null;
    } catch {
      return null;
    }
  },
  save(port) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(port));
    } catch {
      /* storage unavailable */
    }
  },
};

const CONTROL_PORT = /\b(daw|mackie|control|hui|mpk\s*mini\s*mk\d\s*daw)\b/i;

/** Sort ports: playable ports first, then control-surface style ports, then virtual (through) ports. */
export function sortPorts(ports: MidiPort[]): MidiPort[] {
  const rank = (p: MidiPort) => (isVirtualPort(p.name) ? 2 : CONTROL_PORT.test(p.name) ? 1 : 0);
  return [...ports].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function isControlPort(name: string): boolean {
  return CONTROL_PORT.test(name);
}

/**
 * Web MIDI input. Every hardware port is listened to; events reach `onEvent` from the selected
 * port only. Until the selected port plays a note (or the player picks a port in Settings), the
 * first hardware port that plays a note becomes the selected one. That finds the right one of a
 * keyboard's several ports (the Oxygen 25 shows three) without asking.
 */
export class MidiInput {
  status: MidiStatus = 'unsupported';
  private access: MIDIAccess | null = null;
  private selected: MIDIInput | null = null;
  /** the selected port has played a note, or the player chose it: no other port takes over */
  private confirmed = false;
  /** connected input ids, to tell a keyboard coming or going from a port being opened */
  private inputIds = '';
  onEvent: (ev: InputEvent, portId: string) => void = () => {};
  /** a keyboard was plugged in or unplugged, or a port that played a note took over */
  onChange: () => void = () => {};

  constructor(private readonly store: PortStore = localPortStore) {}

  get supported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  get selectedId(): string | null {
    return this.selected?.id ?? null;
  }

  async request(): Promise<MidiStatus> {
    if (!this.supported) return (this.status = 'unsupported');
    this.status = 'pending';
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.status = 'granted';
      this.inputIds = this.connectedIds();
      this.listen();
      this.access.onstatechange = () => {
        this.listen();
        const ids = this.connectedIds();
        if (ids === this.inputIds) return; // a port opened or closed: nothing came or went
        this.inputIds = ids;
        this.onChange();
      };
      return this.status;
    } catch (e) {
      console.warn('MIDI access denied', e);
      return (this.status = 'denied');
    }
  }

  listPorts(): MidiPort[] {
    if (!this.access) return [];
    const ports: MidiPort[] = [];
    this.access.inputs.forEach((p) => ports.push({ id: p.id, name: p.name ?? p.id, state: p.state }));
    return sortPorts(ports);
  }

  /** The player's choice of port; null goes back to picking automatically. Returns the selected id. */
  select(id: string | null): string | null {
    this.selected = null;
    this.confirmed = false;
    if (!id) return this.autoSelect(null);
    const port = this.access?.inputs.get(id);
    if (!port) return null;
    this.selected = port;
    this.confirmed = true;
    this.remember(port);
    this.listen();
    return port.id;
  }

  /**
   * Keep a selection that has played; else pick the remembered port, then `preferredId` (an
   * older saved setting), then the first hardware port. Never a virtual port on its own: one is
   * used only when the player chose it.
   */
  autoSelect(preferredId: string | null): string | null {
    const ports = this.listPorts().filter((p) => p.state === 'connected');
    if (this.selected && this.confirmed && ports.some((p) => p.id === this.selected!.id)) return this.selected.id;
    const hardware = ports.filter((p) => !isVirtualPort(p.name));
    const remembered = this.store.load();
    const pick = (remembered && (ports.find((p) => p.id === remembered.id) ?? hardware.find((p) => p.name === remembered.name)))
      || hardware.find((p) => p.id === preferredId)
      || hardware.find((p) => !isControlPort(p.name))
      || hardware[0];
    this.selected = (pick && this.access?.inputs.get(pick.id)) || null;
    this.confirmed = false;
    this.listen();
    return this.selected?.id ?? null;
  }

  private connectedIds(): string {
    const ids: string[] = [];
    this.access?.inputs.forEach((p) => {
      if (p.state === 'connected') ids.push(p.id);
    });
    return ids.sort().join('\n');
  }

  /** Open every hardware port, and the selected one; a virtual port nobody chose stays closed. */
  private listen(): void {
    this.access?.inputs.forEach((port) => {
      if (port.state !== 'connected' || port.onmidimessage) return;
      if (isVirtualPort(port.name ?? '') && port.id !== this.selected?.id) return;
      port.onmidimessage = (e: MIDIMessageEvent) => this.receive(port, e);
    });
  }

  private receive(port: MIDIInput, e: MIDIMessageEvent): void {
    if (!e.data) return;
    const ev = parseMessage({ data: e.data, perfMs: e.timeStamp }, 'midi');
    if (!ev) return;
    let switched = false;
    if (port.id !== this.selected?.id) {
      if (this.confirmed || ev.type !== 'on' || isVirtualPort(port.name ?? '')) return;
      this.selected = port;
      switched = true;
    }
    if (ev.type === 'on' && !this.confirmed) {
      this.confirmed = true;
      this.remember(port);
    }
    if (switched) this.onChange();
    this.onEvent(ev, port.id);
  }

  private remember(port: MIDIInput): void {
    this.store.save({ id: port.id, name: port.name ?? port.id });
  }
}
