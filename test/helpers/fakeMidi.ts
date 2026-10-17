/** A minimal Web MIDI fake: MIDIAccess with inputs that can be plugged in, unplugged and played. */
import { vi } from 'vitest';

type Handler = ((e: { data: Uint8Array; timeStamp: number }) => void) | null;

export class FakeInput {
  state: 'connected' | 'disconnected' = 'connected';
  connection: 'open' | 'closed' | 'pending' = 'closed';
  private handler: Handler = null;

  constructor(
    readonly access: FakeAccess,
    readonly id: string,
    readonly name: string,
  ) {}

  get onmidimessage(): Handler {
    return this.handler;
  }

  /** As in Chrome, setting a handler opens the port, which fires a statechange. */
  set onmidimessage(h: Handler) {
    this.handler = h;
    if (h && this.connection !== 'open') {
      this.connection = 'open';
      this.access.fire(this);
    }
  }

  noteOn(pitch: number, velocity = 100, timeStamp = 0): void {
    this.handler?.({ data: Uint8Array.from([0x90, pitch, velocity]), timeStamp });
  }
}

export class FakeAccess {
  readonly inputs = new Map<string, FakeInput>();
  readonly outputs = new Map<string, never>();
  onstatechange: ((e: { port: FakeInput }) => void) | null = null;
  sysexEnabled = false;

  constructor(ports: [id: string, name: string][] = []) {
    for (const [id, name] of ports) this.inputs.set(id, new FakeInput(this, id, name));
  }

  fire(port: FakeInput): void {
    this.onstatechange?.({ port });
  }

  plug(id: string, name: string): FakeInput {
    const port = new FakeInput(this, id, name);
    this.inputs.set(id, port);
    this.fire(port);
    return port;
  }

  unplug(id: string): void {
    const port = this.inputs.get(id);
    if (!port) return;
    port.state = 'disconnected';
    port.connection = 'pending';
    this.fire(port);
  }
}

/** Make `navigator.requestMIDIAccess` resolve to `access` (or reject when it is null). */
export function stubMidi(access: FakeAccess | null): void {
  vi.stubGlobal('navigator', {
    requestMIDIAccess: () => (access ? Promise.resolve(access) : Promise.reject(new DOMException('denied', 'SecurityError'))),
  });
}
