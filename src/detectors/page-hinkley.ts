import {
  adaptation,
  integer,
  isFiniteNumber,
  nonNegative,
  option,
  positive,
  readCount,
  readNumber,
  record,
} from '../check';
import type { Adaptation, Detector, Snapshot, Verdict } from '../types';
import { capScore, SKIPPED } from '../types';
import { learns, warming } from './shared';

export interface PageHinkleyOptions {
  /** Changes in the mean smaller than this, in the units of the signal, are tolerated. Default 0.005. */
  readonly delta?: number;
  /** Detection threshold, in the units of the signal times readings. Default 50. */
  readonly lambda?: number;
  /** Readings before the detector may raise an alarm. Default 30. */
  readonly warmup?: number;
  /** Default `"normal-only"`. */
  readonly adapt?: Adaptation;
}

interface PageHinkleyConfig {
  readonly delta: number;
  readonly lambda: number;
  readonly warmup: number;
  readonly adapt: Adaptation;
}

const KIND = 'pageHinkley';

function configure(options?: PageHinkleyOptions): PageHinkleyConfig {
  return {
    delta: nonNegative(KIND, 'delta', option(options, 'delta', 0.005)),
    lambda: positive(KIND, 'lambda', option(options, 'lambda', 50)),
    warmup: integer(KIND, 'warmup', option(options, 'warmup', 30), 1),
    adapt: adaptation(KIND, option(options, 'adapt', 'normal-only')),
  };
}

interface State {
  count: number;
  mean: number;
  /** Cumulative deviation for an upward change, and its running minimum. */
  up: number;
  upMin: number;
  /** Cumulative deviation for a downward change, and its running maximum. */
  down: number;
  downMax: number;
}

const fresh = (): State => ({ count: 0, mean: 0, up: 0, upMin: 0, down: 0, downMax: 0 });

function build(config: PageHinkleyConfig, saved?: Readonly<Record<string, unknown>>): Detector {
  let s = fresh();
  let skipped = 0;
  if (saved) {
    s = {
      count: readCount(KIND, saved, 'count'),
      mean: readNumber(KIND, saved, 'mean'),
      up: readNumber(KIND, saved, 'up'),
      upMin: readNumber(KIND, saved, 'upMin'),
      down: readNumber(KIND, saved, 'down'),
      downMax: readNumber(KIND, saved, 'downMax'),
    };
    skipped = readCount(KIND, saved, 'skipped');
  }

  return {
    kind: KIND,
    get skipped() {
      return skipped;
    },
    update(value: number): Verdict {
      if (!isFiniteNumber(value)) {
        skipped += 1;
        return SKIPPED;
      }
      const ready = s.count >= config.warmup;
      const expected = s.count > 0 ? s.mean : value;
      const up = s.up + value - expected - config.delta;
      const down = s.down + value - expected + config.delta;
      const upMin = Math.min(s.upMin, up);
      const downMax = Math.max(s.downMax, down);
      const statistic = Math.max(up - upMin, downMax - down);
      const score = ready ? capScore(statistic / config.lambda) : 0;
      const anomaly = score > 1;
      // The running mean is the baseline: it stops moving while a drift is being reported, unless told otherwise.
      const moves = !ready || (config.adapt !== 'never' && learns(config.adapt, anomaly));
      const count = moves ? s.count + 1 : s.count;
      const mean = moves ? s.mean + (value - s.mean) / count : s.mean;
      s = { count, mean, up, upMin, down, downMax };
      if (!ready) return warming(expected);
      return anomaly ? { anomaly, score, ready, expected, reason: 'drift' } : { anomaly, score, ready, expected };
    },
    reset() {
      s = fresh();
      skipped = 0;
    },
    snapshot(): Snapshot {
      return { kind: KIND, version: 1, config: { ...config }, state: { ...s, skipped } };
    },
  };
}

/**
 * Flags gradual drift in the mean, such as a sensor slowly losing calibration.
 *
 * It accumulates each reading's distance from the running mean (minus a tolerance `delta`) and compares the
 * sum with its own running extreme. A sustained drift makes that gap grow until it passes `lambda`. Both
 * directions are watched.
 *
 * Source: E. S. Page, "Continuous inspection schemes", Biometrika 41(1/2), 1954; D. V. Hinkley, "Inference
 * about the change-point from cumulative sum tests", Biometrika 58(3), 1971.
 *
 * @example
 * ```ts
 * import { pageHinkley } from 'nazar-js';
 *
 * const drift = pageHinkley({ delta: 0.01, lambda: 20 });
 * drift.update(temperature);
 * ```
 */
export function pageHinkley(options?: PageHinkleyOptions): Detector {
  return build(configure(options));
}

export const pageHinkleyCodec = {
  kind: KIND,
  revive: (config: unknown, state: unknown): Detector =>
    build(configure(record(KIND, config) as PageHinkleyOptions), record(KIND, state)),
};
