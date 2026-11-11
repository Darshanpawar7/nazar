import {
  adaptation,
  integer,
  isFiniteNumber,
  nonNegative,
  option,
  positive,
  readCount,
  readNumbers,
  record,
} from '../check';
import { RollingMedian } from '../stats';
import type { Adaptation, Detector, Snapshot, Verdict } from '../types';
import { SKIPPED } from '../types';
import { banded, learns, ratio, warming } from './shared';

/** Scales the median absolute deviation to match a standard deviation for normally distributed data. */
export const MAD_TO_SIGMA = 1.4826;

export interface HampelOptions {
  /** How many recent readings the median is taken over. An odd whole number, at least 3. Default 51. */
  readonly window?: number;
  /** How many scaled MADs from the median count as anomalous. Default 3. */
  readonly threshold?: number;
  /**
   * The smallest spread to assume, in the units of the signal. Useful for a quantised sensor whose readings are
   * often identical, which would otherwise make the spread zero. Default 0.
   */
  readonly minSpread?: number;
  /** Default `"normal-only"`. */
  readonly adapt?: Adaptation;
}

interface HampelConfig {
  readonly window: number;
  readonly threshold: number;
  readonly minSpread: number;
  readonly adapt: Adaptation;
}

const KIND = 'hampel';

function configure(options?: HampelOptions): HampelConfig {
  const window = integer(KIND, 'window', option(options, 'window', 51), 3, 100_001);
  if (window % 2 === 0) throw new RangeError(`${KIND}: window must be an odd whole number, got ${window}`);
  return {
    window,
    threshold: positive(KIND, 'threshold', option(options, 'threshold', 3)),
    minSpread: nonNegative(KIND, 'minSpread', option(options, 'minSpread', 0)),
    adapt: adaptation(KIND, option(options, 'adapt', 'normal-only')),
  };
}

function build(config: HampelConfig, saved?: Readonly<Record<string, unknown>>): Detector {
  const recent = new RollingMedian(config.window);
  let skipped = 0;
  if (saved) {
    recent.load(readNumbers(KIND, saved, 'window', config.window));
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
      if (!recent.full) {
        recent.push(value);
        return warming(recent.median);
      }
      const expected = recent.median;
      const spread = Math.max(MAD_TO_SIGMA * recent.mad(), config.minSpread);
      const halfWidth = config.threshold * spread;
      const score = ratio(Math.abs(value - expected), halfWidth);
      if (learns(config.adapt, score > 1)) recent.push(value);
      return banded(score, expected, halfWidth, 'spike');
    },
    reset() {
      recent.clear();
      skipped = 0;
    },
    snapshot(): Snapshot {
      return { kind: KIND, version: 1, config: { ...config }, state: { window: [...recent.values()], skipped } };
    },
  };
}

/**
 * Flags spikes robustly: readings far from the rolling median, measured in median absolute deviations.
 *
 * The median and the MAD barely move when an outlier arrives, so one bad reading cannot hide the next one,
 * which is the weakness of a mean-and-variance detector. Costs O(window) per reading.
 *
 * Source: F. R. Hampel, "The influence curve and its role in robust estimation", Journal of the American
 * Statistical Association 69(346), 1974.
 *
 * @example
 * ```ts
 * import { hampel } from 'nazar-js';
 *
 * const detector = hampel({ window: 51, threshold: 3 });
 * const verdict = detector.update(12.4);
 * ```
 */
export function hampel(options?: HampelOptions): Detector {
  return build(configure(options));
}

export const hampelCodec = {
  kind: KIND,
  revive: (config: unknown, state: unknown): Detector =>
    build(configure(record(KIND, config) as HampelOptions), record(KIND, state)),
};
