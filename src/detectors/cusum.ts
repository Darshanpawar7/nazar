import {
  adaptation,
  fraction,
  integer,
  isFiniteNumber,
  nonNegative,
  option,
  positive,
  readCount,
  readNumber,
  record,
} from '../check';
import { EwStats, Welford } from '../stats';
import type { Adaptation, Detector, Snapshot, Verdict } from '../types';
import { capScore, SKIPPED } from '../types';
import { learns, warming } from './shared';

export interface CusumOptions {
  /** Slack, in standard deviations: shifts smaller than this are ignored. Default 0.5. */
  readonly k?: number;
  /** Decision threshold, in standard deviations: the alarm sounds when the cumulative sum passes it. Default 5. */
  readonly h?: number;
  /** Readings used to learn the baseline. Default 50. */
  readonly warmup?: number;
  /** How fast the baseline follows the signal after warm-up, when it is allowed to. Default 0.01. */
  readonly alpha?: number;
  /** Default `"normal-only"`. */
  readonly adapt?: Adaptation;
}

interface CusumConfig {
  readonly k: number;
  readonly h: number;
  readonly warmup: number;
  readonly alpha: number;
  readonly adapt: Adaptation;
}

const KIND = 'cusum';
/** The sums are capped at twice the threshold, so the detector recovers soon after a shift ends. */
const CAP = 2;

function configure(options?: CusumOptions): CusumConfig {
  return {
    k: nonNegative(KIND, 'k', option(options, 'k', 0.5)),
    h: positive(KIND, 'h', option(options, 'h', 5)),
    warmup: integer(KIND, 'warmup', option(options, 'warmup', 50), 2),
    alpha: fraction(KIND, 'alpha', option(options, 'alpha', 0.01)),
    adapt: adaptation(KIND, option(options, 'adapt', 'normal-only')),
  };
}

function build(config: CusumConfig, saved?: Readonly<Record<string, unknown>>): Detector {
  let warm = new Welford();
  let baseline: EwStats | null = null;
  let high = 0;
  let low = 0;
  let skipped = 0;

  if (saved) {
    const learned = readCount(KIND, saved, 'count');
    const mean = readNumber(KIND, saved, 'mean');
    const spread = Math.max(0, readNumber(KIND, saved, 'spread'));
    high = Math.min(CAP * config.h, Math.max(0, readNumber(KIND, saved, 'high')));
    low = Math.min(CAP * config.h, Math.max(0, readNumber(KIND, saved, 'low')));
    skipped = readCount(KIND, saved, 'skipped');
    if (learned >= config.warmup) baseline = new EwStats(config.alpha, mean, spread);
    else warm = Welford.from({ count: learned, mean, m2: spread });
  }

  const ceiling = CAP * config.h;

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
      if (baseline === null) {
        warm.push(value);
        if (warm.count >= config.warmup) baseline = new EwStats(config.alpha, warm.mean, warm.variance);
        return warming(warm.mean);
      }
      const expected = baseline.mean;
      const std = baseline.std;
      const offset = value - expected;
      // With no spread at all, any change at all is as large a step as the detector can register.
      const z = std > 0 ? offset / std : Math.sign(offset) * (ceiling + config.k);
      high = Math.min(ceiling, Math.max(0, high + z - config.k));
      low = Math.min(ceiling, Math.max(0, low - z - config.k));
      const score = capScore(Math.max(high, low) / config.h);
      const anomaly = score > 1;
      if (config.adapt !== 'never' && learns(config.adapt, anomaly)) baseline.push(value);
      return anomaly
        ? { anomaly, score, ready: true, expected, reason: 'shift' }
        : { anomaly, score, ready: true, expected };
    },
    reset() {
      warm = new Welford();
      baseline = null;
      high = 0;
      low = 0;
      skipped = 0;
    },
    snapshot(): Snapshot {
      const learned =
        baseline === null
          ? { count: warm.count, mean: warm.mean, spread: warm.toJSON().m2 }
          : { count: config.warmup, mean: baseline.mean, spread: baseline.variance };
      return { kind: KIND, version: 1, config: { ...config }, state: { ...learned, high, low, skipped } };
    },
  };
}

/**
 * Flags small, sustained shifts in level: the slow leak that never crosses a spike threshold.
 *
 * Each reading is standardised against a learned baseline. Two running sums collect how far readings sit
 * above and below it, minus a slack of `k` standard deviations; the alarm sounds when either sum passes `h`.
 * A shift of one standard deviation is caught within roughly ten readings with the defaults, while a
 * three-sigma threshold on single readings would almost never notice it.
 *
 * Source: E. S. Page, "Continuous inspection schemes", Biometrika 41(1/2), 1954; tabular form as in
 * D. C. Montgomery, "Introduction to Statistical Quality Control".
 *
 * @example
 * ```ts
 * import { cusum } from 'nazar-js';
 *
 * const leak = cusum({ k: 0.5, h: 5 });
 * const verdict = leak.update(flowLitresPerMinute);
 * if (verdict.anomaly) closeValve();
 * ```
 */
export function cusum(options?: CusumOptions): Detector {
  return build(configure(options));
}

export const cusumCodec = {
  kind: KIND,
  revive: (config: unknown, state: unknown): Detector =>
    build(configure(record(KIND, config) as CusumOptions), record(KIND, state)),
};
