import {
  adaptation,
  integer,
  isFiniteNumber,
  option,
  positive,
  fraction,
  readCount,
  readNumber,
  record,
} from '../check';
import { EwStats, Welford } from '../stats';
import type { Adaptation, Detector, Snapshot, Verdict } from '../types';
import { SKIPPED } from '../types';
import { banded, learns, ratio, warming } from './shared';

export interface ZScoreOptions {
  /** How fast the baseline follows the signal, between 0 and 1. Smaller is slower and steadier. Default 0.05. */
  readonly alpha?: number;
  /** How many standard deviations from the mean count as anomalous. Default 3. */
  readonly threshold?: number;
  /** Readings used to learn the first baseline. Default 20. */
  readonly warmup?: number;
  /** Default `"normal-only"`. */
  readonly adapt?: Adaptation;
}

interface ZScoreConfig {
  readonly alpha: number;
  readonly threshold: number;
  readonly warmup: number;
  readonly adapt: Adaptation;
}

const KIND = 'zscore';

function configure(options?: ZScoreOptions): ZScoreConfig {
  return {
    alpha: fraction(KIND, 'alpha', option(options, 'alpha', 0.05)),
    threshold: positive(KIND, 'threshold', option(options, 'threshold', 3)),
    warmup: integer(KIND, 'warmup', option(options, 'warmup', 20), 2),
    adapt: adaptation(KIND, option(options, 'adapt', 'normal-only')),
  };
}

function build(config: ZScoreConfig, saved?: Readonly<Record<string, unknown>>): Detector {
  let warm = new Welford();
  let ew: EwStats | null = null;
  let skipped = 0;

  if (saved) {
    const learned = readCount(KIND, saved, 'count');
    const mean = readNumber(KIND, saved, 'mean');
    const spread = readNumber(KIND, saved, 'spread');
    skipped = readCount(KIND, saved, 'skipped');
    if (learned >= config.warmup) ew = new EwStats(config.alpha, mean, Math.max(0, spread));
    else warm = Welford.from({ count: learned, mean, m2: Math.max(0, spread) });
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
      if (ew === null) {
        warm.push(value);
        if (warm.count >= config.warmup) ew = new EwStats(config.alpha, warm.mean, warm.variance);
        return warming(warm.mean);
      }
      const expected = ew.mean;
      const halfWidth = config.threshold * ew.std;
      const score = ratio(Math.abs(value - expected), halfWidth);
      if (learns(config.adapt, score > 1)) ew.push(value);
      return banded(score, expected, halfWidth, 'spike');
    },
    reset() {
      warm = new Welford();
      ew = null;
      skipped = 0;
    },
    snapshot(): Snapshot {
      const state =
        ew === null
          ? { count: warm.count, mean: warm.mean, spread: warm.toJSON().m2, skipped }
          : { count: config.warmup, mean: ew.mean, spread: ew.variance, skipped };
      return { kind: KIND, version: 1, config: { ...config }, state };
    },
  };
}

/**
 * Flags spikes: readings too many standard deviations from an exponentially weighted mean.
 *
 * Cheap and quick to react, it suits a stable signal where an anomaly is a sudden jump. Because one huge
 * outlier would inflate the variance if it were learned, flagged readings are left out of the baseline by
 * default (see {@link Adaptation}).
 *
 * @example
 * ```ts
 * import { zscore } from 'nazar-js';
 *
 * const detector = zscore({ threshold: 4 });
 * for (const reading of readings) {
 *   const verdict = detector.update(reading);
 *   if (verdict.anomaly) console.log('spike', reading, verdict.score);
 * }
 * ```
 */
export function zscore(options?: ZScoreOptions): Detector {
  return build(configure(options));
}

export const zscoreCodec = {
  kind: KIND,
  revive: (config: unknown, state: unknown): Detector =>
    build(configure(record(KIND, config) as ZScoreOptions), record(KIND, state)),
};
