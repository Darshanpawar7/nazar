/** Why a reading was flagged. */
export type Reason = 'spike' | 'shift' | 'drift' | 'flatline' | 'out-of-range' | 'rate' | 'seasonal';

/**
 * A detector's judgement of one reading.
 *
 * `score` is comparable across detectors: 0 is perfectly normal, 1 is exactly at the detector's threshold,
 * and anything above 1 is anomalous. A detector never flags a reading while it is still warming up.
 */
export interface Verdict {
  readonly anomaly: boolean;
  readonly score: number;
  /** False while the detector is still learning what normal looks like. */
  readonly ready: boolean;
  /** What the detector expected the reading to be, when it has an expectation. */
  readonly expected?: number;
  /** The band of readings the detector would have accepted. */
  readonly lower?: number;
  readonly upper?: number;
  readonly reason?: Reason;
}

/**
 * Whether a detector keeps learning from readings it has flagged.
 *
 * - `normal-only` (the default): flagged readings do not move the baseline, so a slow leak is never learned as
 *   the new normal.
 * - `always`: every reading moves the baseline. The detector forgets an anomaly that lasts long enough.
 * - `never`: the baseline is frozen once warm-up ends.
 */
export type Adaptation = 'normal-only' | 'always' | 'never';

/** A detector's saved state: plain JSON that `restore` turns back into a working detector. */
export interface Snapshot {
  readonly kind: string;
  readonly version: 1;
  readonly config: Readonly<Record<string, unknown>>;
  readonly state: Readonly<Record<string, unknown>>;
  readonly children?: readonly Snapshot[];
}

/** Every detector and combinator has this shape. */
export interface Detector {
  /** The detector's kind, such as `"zscore"`. */
  readonly kind: string;
  /**
   * Judges one reading. Non-finite readings (`NaN`, `Infinity`) are skipped: they do not change the
   * detector's state, and the verdict is never anomalous.
   *
   * @param value - The reading.
   * @param timestamp - When it was taken, in milliseconds. Needed by time-aware detectors such as `seasonal`.
   */
  update(value: number, timestamp?: number): Verdict;
  /** Forgets everything learned so far. Configuration is kept. */
  reset(): void;
  /** The detector's state as plain JSON, for `JSON.stringify` and later `restore`. */
  snapshot(): Snapshot;
  /** How many readings have been skipped because they were not finite numbers. */
  readonly skipped: number;
}

/** The verdict for a reading the detector could not use. */
export const SKIPPED: Verdict = Object.freeze({ anomaly: false, score: 0, ready: false });

/** The largest score a detector reports. Keeps an exact zero-variance baseline from producing Infinity. */
export const MAX_SCORE = 1e6;

export function capScore(score: number): number {
  if (Number.isNaN(score)) return 0;
  return Math.min(MAX_SCORE, Math.max(0, score));
}
