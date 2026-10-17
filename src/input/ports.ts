/** MIDI port-name rules, shared by the port picker and the "no keyboard" banner. */

/**
 * Software ports that no one plays on: Linux and ChromeOS "Midi Through Port-0", the macOS IAC
 * driver, Windows loopMIDI. They are never picked automatically.
 */
const VIRTUAL_PORT = /\bthr(ough|u)\b|\biac\b|loopmidi/i;

export function isVirtualPort(name: string): boolean {
  return VIRTUAL_PORT.test(name);
}
