import {
  adaptation,
  fraction,
  integer,
  isFiniteNumber,
  option,
  positive,
  readCount,
  readNumber,
  readNumbers,
  record,
} from '../check';
import type { Adaptation, Detector, Snapshot, Verdict } from '../types';
import { SKIPPED } from '../types';
import { banded, learns, ratio, warming } from './shared';

export interface SeasonalOptions {
  /** Length of one cycle, in milliseconds. Default one day. */
  readonly period?: number;
  /** How many slots the cycle is cut into. Default 24 (hours of the day). */
  readonly buckets?: number;
  /** How fast each slot's mean follows the signal after warm-up. Default 0.2. */
  readonly alpha?: number;
  /** Standard deviations from the slot's mean that count as anomalous. Default 3. */
  readonly threshold?: number;
  /** Readings each slot needs before it may raise an alarm. Default 3. */
  readonly warmup?: number;
  /** Default `"normal-only"`. */
  readonly adapt?: Adaptation;
}

interface SeasonalConfig {
  readonly period: number;
  readonly buckets: number;
  readonly alpha: number;
  readonly threshold: number;
  readonly warmup: number;
  readonly adapt: Adaptation;
}

const KIND = 'seasonal';
const DAY_MS = 86_400_000;
/** How fast the shared noise estimate follows the signal, once it has seen enough residuals. */
const SPREAD_ALPHA = 0.02;
/** Residuals the shared noise estimate needs before any slot may raise an alarm. */
const SPREAD_WARMUP = 20;

function configure(options?: SeasonalOptions): SeasonalConfig {
  return {
    period: positive(KIND, 'period', option(options, 'period', DAY_MS)),
    buckets: integer(KIND, 'buckets', option(options, 'buckets', 24), 1, 10_000),
    alpha: fraction(KIND, 'alpha', option(options, 'alpha', 0.2)),
    threshold: positive(KIND, 'threshold', option(options, 'threshold', 3)),
    warmup: integer(KIND, 'warmup', option(options, 'warmup', 3), 1),
    adapt: adaptation(KIND, option(options, 'adapt', 'normal-only')),
  };
}

/** Which slot of the cycle a timestamp falls in. Works for timestamps before 1970 too. */
export function slotOf(timestamp: number, period: number, buckets: number): number {
  const phase = ((timestamp % period) + period) % period;
  return Math.min(buckets - 1, Math.floor((phase / period) * buckets));
}

function build(config: SeasonalConfig, saved?: Readonly<Record<string, unknown>>): Detector {
  // Each slot learns its own mean. The noise around those means is learned once, pooled across every slot,
  // because a slot sees few readings (one a day, for hourly slots) and a spread estimated from three readings
  // would make the detector jumpy.
  let counts = new Array<number>(config.buckets).fill(0);
  let means = new Array<number>(config.buckets).fill(0);
  let residuals = 0;
  let variance = 0;
  let skipped = 0;

  if (saved) {
    counts = readNumbers(KIND, saved, 'counts', config.buckets).map(count => Math.max(0, Math.floor(count)));
    means = readNumbers(KIND, saved, 'means', config.buckets);
    if (counts.length !== config.buckets || means.length !== config.buckets) {
      throw new RangeError(`${KIND}: saved state has the wrong number of slots`);
    }
    residuals = readCount(KIND, saved, 'residuals');
    variance = Math.max(0, readNumber(KIND, saved, 'variance'));
    skipped = readCount(KIND, saved, 'skipped');
  }

  /** Folds one prediction error into the shared noise estimate. Mutates only this detector's own state. */
  function learnSpread(error: number, slotCount: number): void {
    // The error of a prediction from a mean of n readings has variance sigma^2 (1 + 1/n); undo that inflation.
    const squared = (error * error * slotCount) / (slotCount + 1);
    residuals += 1;
    variance =
      residuals <= SPREAD_WARMUP
        ? variance + (squared - variance) / residuals
        : (1 - SPREAD_ALPHA) * variance + SPREAD_ALPHA * squared;
  }

  function learnMean(slot: number, value: number): void {
    const count = (counts[slot] as number) + 1;
    const mean = means[slot] as number;
    means[slot] = count <= config.warmup ? mean + (value - mean) / count : mean + config.alpha * (value - mean);
    counts[slot] = count;
  }

  return {
    kind: KIND,
    get skipped() {
      return skipped;
    },
    update(value: number, timestamp?: number): Verdict {
      if (!isFiniteNumber(value) || !isFiniteNumber(timestamp)) {
        skipped += 1;
        return SKIPPED;
      }
      const slot = slotOf(timestamp, config.period, config.buckets);
      const count = counts[slot] as number;
      const expected = means[slot] as number;
      if (count < config.warmup || residuals < SPREAD_WARMUP) {
        if (count > 0) learnSpread(value - expected, count);
        learnMean(slot, value);
        return warming(means[slot]);
      }
      const halfWidth = config.threshold * Math.sqrt(variance);
      const score = ratio(Math.abs(value - expected), halfWidth);
      if (learns(config.adapt, score > 1)) {
        learnSpread(value - expected, count);
        learnMean(slot, value);
      }
      return banded(score, expected, halfWidth, 'seasonal');
    },
    reset() {
      counts = counts.map(() => 0);
      means = means.map(() => 0);
      residuals = 0;
      variance = 0;
      skipped = 0;
    },
    snapshot(): Snapshot {
      return {
        kind: KIND,
        version: 1,
        config: { ...config },
        state: { counts: [...counts], means: [...means], residuals, variance, skipped },
      };
    },
  };
}

/**
 * Flags readings that are wrong for the time of day (or week, or any cycle you choose).
 *
 * The cycle is cut into slots, and each slot learns its own mean; the noise around those means is learned
 * once, across all slots. Water flow of 40 litres a minute is normal at 8 a.m. and a leak at 3 a.m.; a single
 * global threshold cannot tell those apart, this can. Needs a timestamp with every reading.
 *
 * @example
 * ```ts
 * import { seasonal } from 'nazar-js';
 *
 * const nightly = seasonal({ period: 86_400_000, buckets: 24 });
 * nightly.update(litresPerMinute, Date.now());
 * ```
 */
export function seasonal(options?: SeasonalOptions): Detector {
  return build(configure(options));
}

export const seasonalCodec = {
  kind: KIND,
  revive: (config: unknown, state: unknown): Detector =>
    build(configure(record(KIND, config) as SeasonalOptions), record(KIND, state)),
};
