/**
 * A fake Web MIDI device for the hill harnesses, installed with Playwright's addInitScript
 * before any page script runs. It replaces navigator.requestMIDIAccess with an access object
 * whose inputs the harness controls from outside through window.__fakeMidi:
 *
 *   plug(id, name)     add an input port and fire statechange, as a hot-plug would
 *   unplug(id)         remove it and fire statechange
 *   send(id, bytes)    deliver a MIDI message from that port to whatever listens on it
 *   listening()        ids of the ports the page has a message listener on
 *
 * The default ports mirror the classroom Chromebooks on 17 Oct 2026: the system's
 * "Midi Through Port-0" plus three Oxygen 25 entries, of which only the first sends keys.
 * The Oxygen port names are an assumption; the order and count are from Jeremy's report.
 *
 * Runs in the page: no imports, no closures over Node values.
 */
export function installFakeMidi(config) {
  const inputs = new Map();
  const outputs = new Map();
  const access = new EventTarget();
  access.inputs = inputs;
  access.outputs = outputs;
  access.sysexEnabled = false;
  access.onstatechange = null;
  let requests = 0;

  class FakeInput extends EventTarget {
    constructor(id, name) {
      super();
      this.id = id;
      this.name = name;
      this.manufacturer = '';
      this.version = '';
      this.type = 'input';
      this.state = 'connected';
      this.connection = 'closed';
      this.onstatechange = null;
      this._onmessage = null;
      this._listeners = 0;
    }
    get onmidimessage() { return this._onmessage; }
    set onmidimessage(fn) {
      this._onmessage = typeof fn === 'function' ? fn : null;
      if (this._onmessage) this.connection = 'open';
    }
    addEventListener(type, fn, opts) {
      if (type === 'midimessage') { this._listeners++; this.connection = 'open'; }
      super.addEventListener(type, fn, opts);
    }
    removeEventListener(type, fn, opts) {
      if (type === 'midimessage') this._listeners = Math.max(0, this._listeners - 1);
      super.removeEventListener(type, fn, opts);
    }
    open() { this.connection = 'open'; return Promise.resolve(this); }
    close() { this.connection = 'closed'; return Promise.resolve(this); }
    get listening() { return !!this._onmessage || this._listeners > 0; }
  }

  function fireState(port) {
    const ev = new Event('statechange');
    Object.defineProperty(ev, 'port', { value: port });
    if (typeof access.onstatechange === 'function') access.onstatechange(ev);
    access.dispatchEvent(ev);
  }

  function plug(id, name, silent = false) {
    const port = new FakeInput(id, name);
    inputs.set(id, port);
    if (!silent) fireState(port);
    return port;
  }

  for (const p of config.ports) plug(p.id, p.name, true);

  Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', {
    configurable: true,
    value: function requestMIDIAccess() {
      requests++;
      return config.deny ? Promise.reject(new DOMException('denied', 'SecurityError')) : Promise.resolve(access);
    },
  });

  window.__fakeMidi = {
    plug: (id, name) => { plug(id, name); },
    unplug(id) {
      const port = inputs.get(id);
      if (!port) return;
      inputs.delete(id);
      port.state = 'disconnected';
      port.connection = 'closed';
      fireState(port);
    },
    send(id, bytes) {
      const port = inputs.get(id);
      if (!port) return false;
      const data = new Uint8Array(bytes);
      const ev = typeof MIDIMessageEvent === 'function'
        ? new MIDIMessageEvent('midimessage', { data })
        : Object.assign(new Event('midimessage'), { data });
      if (port._onmessage) port._onmessage.call(port, ev);
      port.dispatchEvent(ev);
      return port.listening;
    },
    listening: () => [...inputs.values()].filter((p) => p.listening).map((p) => p.id),
    get requests() { return requests; },
  };
}

export const CLASSROOM_PORTS = [
  { id: 'through', name: 'Midi Through Port-0' },
  { id: 'oxygen-1', name: 'Oxygen 25 MIDI 1' },
  { id: 'oxygen-2', name: 'Oxygen 25 MIDI 2' },
  { id: 'oxygen-3', name: 'Oxygen 25 MIDI 3' },
];
/** The port the keys arrive on. */
export const KEYBOARD_PORT = 'oxygen-1';
