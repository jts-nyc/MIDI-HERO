import { parseMessage, type InputEvent } from './normalize.ts';

export interface MidiPort {
  id: string;
  name: string;
  state: string;
}

export type MidiStatus = 'unsupported' | 'pending' | 'granted' | 'denied';

const CONTROL_PORT = /\b(daw|mackie|control|hui|mpk\s*mini\s*mk\d\s*daw)\b/i;

/** Sort ports: control-surface style ports last. */
export function sortPorts(ports: MidiPort[]): MidiPort[] {
  return [...ports].sort((a, b) => Number(CONTROL_PORT.test(a.name)) - Number(CONTROL_PORT.test(b.name)) || a.name.localeCompare(b.name));
}

export function isControlPort(name: string): boolean {
  return CONTROL_PORT.test(name);
}

export class MidiInput {
  status: MidiStatus = 'unsupported';
  private access: MIDIAccess | null = null;
  private selected: MIDIInput | null = null;
  onEvent: (ev: InputEvent, portId: string) => void = () => {};
  onChange: () => void = () => {};

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
      this.access.onstatechange = () => this.onChange();
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

  /** Select a port by id; null clears. Returns the selected id. */
  select(id: string | null): string | null {
    if (this.selected) {
      this.selected.onmidimessage = null;
      this.selected = null;
    }
    if (!this.access || !id) return null;
    const port = this.access.inputs.get(id) ?? null;
    if (!port) return null;
    this.selected = port;
    port.onmidimessage = (e: MIDIMessageEvent) => {
      if (!e.data) return;
      const ev = parseMessage({ data: e.data, perfMs: e.timeStamp }, 'midi');
      if (ev) this.onEvent(ev, port.id);
    };
    return port.id;
  }

  /** Pick the preferred id if present, else the single sensible port, else the first non-control port. */
  autoSelect(preferredId: string | null): string | null {
    const ports = this.listPorts();
    if (preferredId && ports.some((p) => p.id === preferredId)) return this.select(preferredId);
    const sensible = ports.filter((p) => !isControlPort(p.name));
    const pick = sensible[0] ?? null;
    return this.select(pick?.id ?? null);
  }
}
