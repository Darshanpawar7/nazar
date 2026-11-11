/**
 * Small streaming statistics used by the detectors. Each keeps constant memory (or memory bounded by its
 * window) and mutates only its own internal buffers, which is the point of a streaming accumulator.
 */

/**
 * Count, mean and variance in one pass, numerically stable.
 *
 * Welford's update accumulates squared deviations from the running mean instead of raw sums of squares, so
 * it stays accurate when a small spread rides on a large offset, and the variance can never go negative.
 * Source: B. P. Welford, "Note on a method for calculating corrected sums of squares and products",
 * Technometrics 4(3), 1962.
 */
export class Welford {
  count = 0;
  mean = 0;
  private m2 = 0;

  push(value: number): void {
    this.count += 1;
    const delta = value - this.mean;
    this.mean += delta / this.count;
    this.m2 += delta * (value - this.mean);
  }

  /** Population variance. */
  get variance(): number {
    return this.count > 0 ? this.m2 / this.count : 0;
  }

  get std(): number {
    return Math.sqrt(this.variance);
  }

  toJSON(): { count: number; mean: number; m2: number } {
    return { count: this.count, mean: this.mean, m2: this.m2 };
  }

  static from(state: { count: number; mean: number; m2: number }): Welford {
    const restored = new Welford();
    restored.count = state.count;
    restored.mean = state.mean;
    restored.m2 = Math.max(0, state.m2);
    return restored;
  }
}

/**
 * Exponentially weighted mean and variance: recent readings count more, old ones fade.
 * Source: T. Finch, "Incremental calculation of weighted mean and variance", University of Cambridge, 2009.
 */
export class EwStats {
  mean: number;
  variance: number;

  constructor(
    private readonly alpha: number,
    mean = 0,
    variance = 0,
  ) {
    this.mean = mean;
    this.variance = variance;
  }

  push(value: number): void {
    const delta = value - this.mean;
    const increment = this.alpha * delta;
    this.mean += increment;
    this.variance = (1 - this.alpha) * (this.variance + delta * increment);
  }

  get std(): number {
    return Math.sqrt(Math.max(0, this.variance));
  }
}

/** The last `capacity` values, oldest first. */
export class Window {
  private items: number[] = [];

  constructor(readonly capacity: number) {}

  push(value: number): void {
    this.items.push(value);
    if (this.items.length > this.capacity) this.items.shift();
  }

  get size(): number {
    return this.items.length;
  }

  get full(): boolean {
    return this.items.length >= this.capacity;
  }

  values(): readonly number[] {
    return this.items;
  }

  clear(): void {
    this.items = [];
  }

  load(values: readonly number[]): void {
    this.items = values.slice(-this.capacity);
  }
}

/** Index of the first element not less than `value` in a sorted array. */
function lowerBound(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((sorted[middle] as number) < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The median of a sorted array. */
export function medianOfSorted(sorted: readonly number[]): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const half = n >>> 1;
  return n % 2 === 1 ? (sorted[half] as number) : ((sorted[half - 1] as number) + (sorted[half] as number)) / 2;
}

/**
 * The median of the last `capacity` values. Keeps a sorted copy alongside the arrival order, so each update
 * costs O(capacity) and reading the median costs O(1).
 */
export class RollingMedian {
  private readonly arrivals: Window;
  private sorted: number[] = [];

  constructor(capacity: number) {
    this.arrivals = new Window(capacity);
  }

  push(value: number): void {
    if (this.arrivals.full) {
      const oldest = this.arrivals.values()[0] as number;
      this.sorted.splice(lowerBound(this.sorted, oldest), 1);
    }
    this.arrivals.push(value);
    this.sorted.splice(lowerBound(this.sorted, value), 0, value);
  }

  get size(): number {
    return this.arrivals.size;
  }

  get full(): boolean {
    return this.arrivals.full;
  }

  get median(): number {
    return medianOfSorted(this.sorted);
  }

  /** Median absolute deviation from the median, unscaled. */
  mad(): number {
    const centre = this.median;
    const deviations = this.sorted.map(value => Math.abs(value - centre)).sort((a, b) => a - b);
    return medianOfSorted(deviations);
  }

  values(): readonly number[] {
    return this.arrivals.values();
  }

  clear(): void {
    this.arrivals.clear();
    this.sorted = [];
  }

  load(values: readonly number[]): void {
    this.arrivals.load(values);
    this.sorted = [...this.arrivals.values()].sort((a, b) => a - b);
  }
}

/**
 * A small, fast, seeded pseudo-random generator returning numbers in [0, 1).
 * Source: T. Ettinger, "mulberry32", public domain.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal samples from a uniform generator, by the Box-Muller transform. */
export function gaussian(random: () => number): () => number {
  return () => {
    const u = Math.max(random(), Number.EPSILON);
    const v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}
