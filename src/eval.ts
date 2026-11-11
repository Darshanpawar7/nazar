/**
 * Scoring a detector against labelled data, the way an operator experiences it: by events, not by readings.
 * A leak that lasts 200 readings is one event, caught or missed, however many of its readings were flagged.
 */

export interface Evaluation {
  /** Labelled events that were flagged at least once (within the tolerance after they ended). */
  readonly detected: number;
  readonly events: number;
  /** Separate runs of flags that touch no labelled event. */
  readonly falseAlarms: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  /** Readings from the start of each detected event to its first flag, averaged. NaN when nothing was detected. */
  readonly meanDelay: number;
}

export interface EvaluateOptions {
  /** Flags this many readings after an event ends still count as catching it. Default 0. */
  readonly tolerance?: number;
}

interface Run {
  readonly start: number;
  /** Exclusive. */
  readonly end: number;
}

/** The contiguous runs of `true`. */
export function runs(flags: readonly boolean[]): Run[] {
  const found: Run[] = [];
  let start = -1;
  flags.forEach((flag, index) => {
    if (flag && start < 0) start = index;
    if (!flag && start >= 0) {
      found.push({ start, end: index });
      start = -1;
    }
  });
  if (start >= 0) found.push({ start, end: flags.length });
  return found;
}

/**
 * Event-based precision, recall, F1 and detection delay.
 *
 * @param flagged - The detector's `anomaly` for each reading.
 * @param labels - The ground truth for each reading.
 *
 * @example
 * ```ts
 * import { cusum } from 'nazar-js';
 * import { evaluate } from 'nazar-js/eval';
 * import { waterFlowWithLeak } from 'nazar-js/synth';
 *
 * const data = waterFlowWithLeak();
 * const detector = cusum();
 * const flagged = data.values.map(value => detector.update(value).anomaly);
 * evaluate(flagged, data.labels); // { recall: 1, precision: ..., meanDelay: ... }
 * ```
 */
export function evaluate(
  flagged: readonly boolean[],
  labels: readonly boolean[],
  options?: EvaluateOptions,
): Evaluation {
  if (flagged.length !== labels.length) throw new RangeError('evaluate: flagged and labels must be the same length');
  const tolerance = Math.max(0, Math.floor(options?.tolerance ?? 0));
  const events = runs(labels);
  const windows = events.map(event => ({ start: event.start, end: Math.min(labels.length, event.end + tolerance) }));
  const inWindow = (index: number) => windows.some(window => index >= window.start && index < window.end);

  const delays = windows
    .map(window => {
      const first = flagged.findIndex((flag, index) => flag && index >= window.start && index < window.end);
      return first < 0 ? null : first - window.start;
    })
    .filter((delay): delay is number => delay !== null);

  const falseAlarms = runs(flagged.map((flag, index) => flag && !inWindow(index))).length;
  const detected = delays.length;
  const precision = detected + falseAlarms === 0 ? 0 : detected / (detected + falseAlarms);
  const recall = events.length === 0 ? 0 : detected / events.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const meanDelay = detected === 0 ? Number.NaN : delays.reduce((sum, delay) => sum + delay, 0) / detected;
  return { detected, events: events.length, falseAlarms, precision, recall, f1, meanDelay };
}
