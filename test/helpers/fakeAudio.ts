// Minimal fake AudioContext for synth tests. Records oscillator start times.
export interface FakeParam { value: number; setValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void; setTargetAtTime(v: number, t: number, c: number): void; cancelScheduledValues(t: number): void }

const param = (): FakeParam => ({
  value: 0,
  setValueAtTime(v) { this.value = v; },
  linearRampToValueAtTime() {},
  exponentialRampToValueAtTime() {},
  setTargetAtTime() {},
  cancelScheduledValues() {},
});

class Node {
  connect(n: unknown): unknown { return n; }
  disconnect(): void {}
}

export class FakeOscillator extends Node {
  type = 'sine';
  frequency = param();
  detune = param();
  started: number | null = null;
  stopped: number | null = null;
  onended: (() => void) | null = null;
  start(t: number): void { this.started = t; }
  stop(t: number): void { this.stopped = t; }
}

export class FakeAudioContext {
  currentTime = 5;
  sampleRate = 48000;
  state = 'running';
  destination = new Node();
  oscillators: FakeOscillator[] = [];
  createGain() { return Object.assign(new Node(), { gain: param() }); }
  createBiquadFilter() { return Object.assign(new Node(), { type: 'lowpass', frequency: param(), Q: param() }); }
  createDynamicsCompressor() { return Object.assign(new Node(), { threshold: param(), ratio: param() }); }
  createOscillator() { const o = new FakeOscillator(); this.oscillators.push(o); return o; }
  createBuffer(_c: number, len: number) { return { getChannelData: () => new Float32Array(len) }; }
  createBufferSource() { return Object.assign(new Node(), { buffer: null, start() {}, stop() {} }); }
  getOutputTimestamp() { return { contextTime: this.currentTime - 0.02, performanceTime: 1000 }; }
}
