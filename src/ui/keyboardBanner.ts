/** "Plug in your keyboard" banner: shown while MIDI is allowed but no hardware keyboard is connected. */
import type { MidiPort, MidiStatus } from '../input/midiInput.ts';
import { isVirtualPort } from '../input/ports.ts';

export const BANNER_TEXT = 'Plug in your keyboard, then refresh the page.';

interface MidiState {
  status: MidiStatus;
  readonly selectedId: string | null;
  readonly usingComputerKeys?: boolean;
  useComputerKeys?(): void;
  listPorts(): MidiPort[];
}

/** A connected port someone can play: not a software port such as "Midi Through". */
export function hasKeyboard(ports: readonly MidiPort[]): boolean {
  return ports.some((p) => p.state === 'connected' && !isVirtualPort(p.name));
}

/**
 * Only once MIDI is allowed: an unsupported or blocked browser has its own message. The banner
 * stays until a real keyboard is the selected port, not merely connected: a selected "Midi
 * Through" still plays nothing. Chrome often reports a keyboard plugged in later (the banner then
 * goes away by itself), but not on every system, hence "refresh".
 */
export function needsKeyboardBanner(midi: MidiState): boolean {
  return midi.status === 'granted' && !midi.usingComputerKeys && !hasKeyboard(midi.listPorts().filter((p) => p.id === midi.selectedId));
}

let el: HTMLElement | null = null;
let dismissed = false;

/** Show or hide the banner for the current MIDI state. Returns whether it is showing. */
export function updateKeyboardBanner(midi: MidiState): boolean {
  if (!needsKeyboardBanner(midi)) {
    el?.remove();
    el = null;
    dismissed = false; // a later unplug shows it again
    return false;
  }
  if (dismissed || typeof document === 'undefined') return false;
  if (el?.isConnected) return true;
  el = document.createElement('div');
  el.setAttribute('role', 'alert');
  el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:1000;max-width:calc(100% - 24px);'
    + 'display:flex;gap:14px;align-items:center;flex-wrap:wrap;justify-content:center;padding:12px 18px;border-radius:12px;'
    + 'background:#3a2a0b;border:2px solid #ffb020;color:#fff;font:600 20px system-ui,sans-serif;box-shadow:0 6px 24px #0008';
  el.innerHTML = `<span>${BANNER_TEXT}</span>`
    + '<button data-act="reload" style="font:inherit;padding:6px 16px;border-radius:8px;border:0;background:#ffb020;color:#000;cursor:pointer">Refresh</button>'
    + '<button data-act="close" style="font:inherit;font-size:15px;padding:6px 12px;border-radius:8px;border:1px solid #fff6;background:none;color:#fff;cursor:pointer">Use computer keys</button>';
  el.querySelector('[data-act="reload"]')!.addEventListener('click', () => location.reload());
  el.querySelector('[data-act="close"]')!.addEventListener('click', () => {
    midi.useComputerKeys?.();
    dismissed = true;
    el?.remove();
    el = null;
  });
  document.body.appendChild(el);
  return true;
}
