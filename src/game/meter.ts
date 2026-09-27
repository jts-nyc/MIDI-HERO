/** Performance meter ("rock meter") and streak milestones. Pure. */

export interface MeterConfig {
  /** health at the start of a song, 0..1 */
  start: number;
  hit: number;
  miss: number;
  wrong: number;
  /** a right key far off the beat: consumed, no credit */
  late: number;
  /** the song fails when health falls to this value; null = never (class mode) */
  failAt: number | null;
}

export const DEFAULT_METER: MeterConfig = { start: 0.6, hit: 0.03, miss: -0.08, wrong: -0.04, late: -0.04, failAt: null };

export type MeterZone = 'green' | 'yellow' | 'red';

/** Below this health the highway dims and the band thins out. */
export const LOW_HEALTH = 0.3;
const GREEN_HEALTH = 0.6;
/** Level of the thinned parts of the mix when health is gone. */
const MIX_FLOOR = 0.15;

export class PerformanceMeter {
  health: number;
  failed = false;
  readonly config: MeterConfig;

  constructor(config: Partial<MeterConfig> = {}) {
    this.config = { ...DEFAULT_METER, ...config };
    this.health = clamp01(this.config.start);
  }

  private add(delta: number): void {
    this.health = clamp01(this.health + delta);
    const failAt = this.config.failAt;
    if (failAt !== null && this.health <= failAt) this.failed = true;
  }

  hit(): void { this.add(this.config.hit); }
  miss(): void { this.add(this.config.miss); }
  wrong(): void { this.add(this.config.wrong); }
  late(): void { this.add(this.config.late); }
  /** Take `amount` of health, for anything that is not a hit, a miss or a wrong note. */
  penalty(amount: number): void { this.add(-Math.abs(amount)); }

  get zone(): MeterZone {
    return this.health >= GREEN_HEALTH ? 'green' : this.health >= LOW_HEALTH ? 'yellow' : 'red';
  }

  get low(): boolean {
    return this.health < LOW_HEALTH;
  }

  /** 1 while the player is doing fine; falls toward MIX_FLOOR as health goes from LOW_HEALTH to 0. */
  get mixLevel(): number {
    if (this.health >= LOW_HEALTH) return 1;
    return MIX_FLOOR + (1 - MIX_FLOOR) * (this.health / LOW_HEALTH);
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Streak lengths that get a call-out: 10, 25, 50, 100, then every further 100. */
export function isMilestone(streak: number): boolean {
  return streak === 10 || streak === 25 || streak === 50 || (streak >= 100 && streak % 100 === 0);
}
