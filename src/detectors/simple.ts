import {
  integer,
  isFiniteNumber,
  nonNegative,
  oneOf,
  option,
  positive,
  readCount,
  readNumber,
  readNumbers,
  record,
} from '../check';
import type { Detector, Snapshot, Verdict } from '../types';
import { capScore, SKIPPED } from '../types';

// ---------------------------------------------------------------- flatline

export interface FlatlineOptions {
  /** How many readings in a row may stay within `tolerance` before the sensor counts as stuck. Default 10. */
  readonly samples?: number;
  /** The largest change that still counts as "the same reading". Default 0. */
  readonly tolerance?: number;
}

interface FlatlineConfig {
  readonly samples: number;
  readonly tolerance: number;
}

function flatlineConfig(options?: FlatlineOptions): FlatlineConfig {
  return {
    samples: integer('flatline', 'samples', option(options, 'samples', 10), 2, 1_000_000),
    tolerance: nonNegative('flatline', 'tolerance', option(options, 'tolerance', 0)),
  };
}

function buildFlatline(config: FlatlineConfig, saved?: Readonly<Record<string, unknown>>): Detector {
  // The current run: its length, and the lowest and highest readings in it.
  let run = 0;
  let low = 0;
  let high = 0;
  let skipped = 0;
  if (saved) {
    run = readCount('flatline', saved, 'run');
    low = readNumber('flatline', saved, 'low');
    high = readNumber('flatline', saved, 'high');
    skipped = readCount('flatline', saved, 'skipped');
  }
  return {
    kind: 'flatline',
    get skipped() {
      return skipped;
    },
    update(value: number): Verdict {
      if (!isFiniteNumber(value)) {
        skipped += 1;
        return SKIPPED;
      }
      const nextLow = run === 0 ? value : Math.min(low, value);
      const nextHigh = run === 0 ? value : Math.max(high, value);
      if (nextHigh - nextLow <= config.tolerance) {
        run += 1;
        low = nextLow;
        high = nextHigh;
      } else {
        run = 1;
        low = value;
        high = value;
      }
      const score = capScore(run / config.samples);
      const ready = true;
      return score > 1
        ? { anomaly: true, score, ready, expected: value, reason: 'flatline' }
        : { anomaly: false, score, ready, expected: value };
    },
    reset() {
      run = 0;
      low = 0;
      high = 0;
      skipped = 0;
    },
    snapshot(): Snapshot {
      return { kind: 'flatline', version: 1, config: { ...config }, state: { run, low, high, skipped } };
    },
  };
}

/**
 * Flags a stuck sensor: more than `samples` readings in a row that stay within `tolerance` of each other.
 *
 * Real sensors are never perfectly still. A tank level that reads 41.20 for an hour is a frozen sensor, not a
 * calm tank. The score is the current run length divided by `samples`.
 *
 * @example
 * ```ts
 * import { flatline } from 'nazar-js';
 *
 * const stuck = flatline({ samples: 30, tolerance: 0.01 });
 * ```
 */
export function flatline(options?: FlatlineOptions): Detector {
  return buildFlatline(flatlineConfig(options));
}

// ---------------------------------------------------------------- range

export interface RangeOptions {
  /** The lowest physically possible reading. */
  readonly min: number;
  /** The highest physically possible reading. */
  readonly max: number;
}

function rangeConfig(options: RangeOptions): RangeOptions {
  const min = option(options, 'min', undefined);
  const max = option(options, 'max', undefined);
  if (!isFiniteNumber(min) || !isFiniteNumber(max) || min >= max) {
    throw new RangeError(
      `range: min and max must be finite numbers with min below max, got ${String(min)} and ${String(max)}`,
    );
  }
  return { min, max };
}

function buildRange(config: RangeOptions, saved?: Readonly<Record<string, unknown>>): Detector {
  let skipped = saved ? readCount('range', saved, 'skipped') : 0;
  const span = config.max - config.min;
  const centre = (config.max + config.min) / 2;
  return {
    kind: 'range',
    get skipped() {
      return skipped;
    },
    update(value: number): Verdict {
      if (!isFiniteNumber(value)) {
        skipped += 1;
        return SKIPPED;
      }
      const base = { ready: true, expected: centre, lower: config.min, upper: config.max };
      if (value < config.min || value > config.max) {
        const excess = value < config.min ? config.min - value : value - config.max;
        return { ...base, anomaly: true, score: capScore(1 + excess / span), reason: 'out-of-range' };
      }
      // Inside the range the score rises from 0 at the centre to 1 at either limit.
      return { ...base, anomaly: false, score: Math.abs(value - centre) / (span / 2) };
    },
    reset() {
      skipped = 0;
    },
    snapshot(): Snapshot {
      return { kind: 'range', version: 1, config: { ...config }, state: { skipped } };
    },
  };
}

/**
 * Flags physically impossible readings: below `min` or above `max`.
 *
 * The simplest detector and often the most valuable one. A negative flow or a humidity of 140% is a wiring
 * fault, and no statistics are needed to say so.
 *
 * @example
 * ```ts
 * import { range } from 'nazar-js';
 *
 * const humidity = range({ min: 0, max: 100 });
 * ```
 */
export function range(options: RangeOptions): Detector {
  return buildRange(rangeConfig(options));
}

// ---------------------------------------------------------------- rate of change

export interface RateOfChangeOptions {
  /** The largest change between readings that is still normal. */
  readonly maxDelta: number;
  /** Measure the change per reading (default) or per second, which needs timestamps. */
  readonly per?: 'reading' | 'second';
}

interface RateConfig {
  readonly maxDelta: number;
  readonly per: 'reading' | 'second';
}

function rateConfig(options: RateOfChangeOptions): RateConfig {
  return {
    maxDelta: positive('rateOfChange', 'maxDelta', option(options, 'maxDelta', undefined)),
    per: oneOf('rateOfChange', 'per', option(options, 'per', 'reading'), ['reading', 'second'] as const),
  };
}

const MS_PER_SECOND = 1000;

function buildRate(config: RateConfig, saved?: Readonly<Record<string, unknown>>): Detector {
  let previous: number[] = [];
  let skipped = 0;
  if (saved) {
    previous = readNumbers('rateOfChange', saved, 'previous', 2);
    skipped = readCount('rateOfChange', saved, 'skipped');
  }
  const perSecond = config.per === 'second';
  return {
    kind: 'rateOfChange',
    get skipped() {
      return skipped;
    },
    update(value: number, timestamp?: number): Verdict {
      if (!isFiniteNumber(value) || (perSecond && !isFiniteNumber(timestamp))) {
        skipped += 1;
        return SKIPPED;
      }
      const [lastValue, lastTime] = previous;
      previous = perSecond ? [value, timestamp as number] : [value];
      if (lastValue === undefined) return { anomaly: false, score: 0, ready: false, expected: value };
      const seconds = perSecond && lastTime !== undefined ? ((timestamp as number) - lastTime) / MS_PER_SECOND : 1;
      if (seconds <= 0) return { anomaly: false, score: 0, ready: true, expected: lastValue };
      const allowed = config.maxDelta * seconds;
      const score = capScore(Math.abs(value - lastValue) / allowed);
      const base = { score, ready: true, expected: lastValue, lower: lastValue - allowed, upper: lastValue + allowed };
      return score > 1 ? { ...base, anomaly: true, reason: 'rate' } : { ...base, anomaly: false };
    },
    reset() {
      previous = [];
      skipped = 0;
    },
    snapshot(): Snapshot {
      return { kind: 'rateOfChange', version: 1, config: { ...config }, state: { previous: [...previous], skipped } };
    },
  };
}

/**
 * Flags impossible jumps: a change from one reading to the next larger than `maxDelta`.
 *
 * With `per: 'second'` the allowance scales with the time since the last reading, so irregular sampling and
 * gaps in the data are handled correctly.
 *
 * @example
 * ```ts
 * import { rateOfChange } from 'nazar-js';
 *
 * // A 5,000-litre tank cannot fill faster than its inlet allows.
 * const tank = rateOfChange({ maxDelta: 0.5, per: 'second' });
 * tank.update(levelPercent, Date.now());
 * ```
 */
export function rateOfChange(options: RateOfChangeOptions): Detector {
  return buildRate(rateConfig(options));
}

// ---------------------------------------------------------------- codecs

export const flatlineCodec = {
  kind: 'flatline',
  revive: (config: unknown, state: unknown): Detector =>
    buildFlatline(flatlineConfig(record('flatline', config) as FlatlineOptions), record('flatline', state)),
};

export const rangeCodec = {
  kind: 'range',
  revive: (config: unknown, state: unknown): Detector =>
    buildRange(rangeConfig(record('range', config) as unknown as RangeOptions), record('range', state)),
};

export const rateOfChangeCodec = {
  kind: 'rateOfChange',
  revive: (config: unknown, state: unknown): Detector =>
    buildRate(
      rateConfig(record('rateOfChange', config) as unknown as RateOfChangeOptions),
      record('rateOfChange', state),
    ),
};
