import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EwStats, gaussian, medianOfSorted, mulberry32, RollingMedian, Welford } from '../src/stats';

const finite = fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true });

/** Two-pass reference: the textbook definition, computed the slow, obvious way. */
function reference(values: readonly number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { mean, variance };
}

describe('Welford', () => {
  it('matches the two-pass mean and variance for any list of numbers', () => {
    fc.assert(
      fc.property(fc.array(finite, { minLength: 1, maxLength: 200 }), values => {
        const stats = new Welford();
        values.forEach(value => stats.push(value));
        const expected = reference(values);
        const scale = Math.max(1, ...values.map(Math.abs));
        expect(stats.count).toBe(values.length);
        expect(Math.abs(stats.mean - expected.mean)).toBeLessThanOrEqual(1e-9 * scale);
        expect(Math.abs(stats.variance - expected.variance)).toBeLessThanOrEqual(1e-6 * scale * scale);
      }),
    );
  });

  it('stays accurate when a tiny spread rides on a huge offset, where the naive formula collapses', () => {
    const values = Array.from({ length: 10_000 }, (_, index) => 1e9 + (index % 2 === 0 ? 0.5 : -0.5));
    const stats = new Welford();
    values.forEach(value => stats.push(value));
    const naive = values.reduce((sum, value) => sum + value * value, 0) / values.length - stats.mean ** 2;
    expect(stats.variance).toBeCloseTo(0.25, 9);
    expect(Math.abs(naive - 0.25)).toBeGreaterThan(1); // the textbook shortcut is wrong here
  });

  it('never reports a negative variance, and round-trips through JSON', () => {
    fc.assert(
      fc.property(fc.array(finite, { minLength: 1, maxLength: 50 }), values => {
        const stats = new Welford();
        values.forEach(value => stats.push(value));
        expect(stats.variance).toBeGreaterThanOrEqual(0);
        const copy = Welford.from(JSON.parse(JSON.stringify(stats.toJSON())));
        expect(copy.mean).toBe(stats.mean);
        expect(copy.variance).toBe(stats.variance);
      }),
    );
    expect(new Welford().variance).toBe(0);
  });
});

describe('EwStats', () => {
  it('converges to a constant signal with zero variance', () => {
    const stats = new EwStats(0.1, 0, 4);
    for (let index = 0; index < 500; index++) stats.push(7);
    expect(stats.mean).toBeCloseTo(7, 9);
    expect(stats.std).toBeCloseTo(0, 6);
  });

  it('tracks the standard deviation of steady noise', () => {
    const normal = gaussian(mulberry32(42));
    const stats = new EwStats(0.01, 0, 1);
    for (let index = 0; index < 20_000; index++) stats.push(3 + 2 * normal());
    expect(stats.mean).toBeCloseTo(3, 0);
    expect(stats.std).toBeGreaterThan(1.6);
    expect(stats.std).toBeLessThan(2.4);
  });
});

describe('RollingMedian', () => {
  it('equals the median of the sorted window after every update', () => {
    fc.assert(
      fc.property(
        fc.array(finite, { minLength: 1, maxLength: 120 }),
        fc.integer({ min: 1, max: 15 }),
        (values, size) => {
          const median = new RollingMedian(size);
          values.forEach((value, index) => {
            median.push(value);
            const window = values.slice(Math.max(0, index - size + 1), index + 1).sort((a, b) => a - b);
            expect(median.median).toBe(medianOfSorted(window));
          });
        },
      ),
    );
  });

  it('computes the median absolute deviation, and reloads from saved values', () => {
    const median = new RollingMedian(5);
    [1, 2, 3, 4, 100].forEach(value => median.push(value));
    expect(median.median).toBe(3);
    expect(median.mad()).toBe(1);
    const copy = new RollingMedian(5);
    copy.load([...median.values()]);
    expect(copy.median).toBe(3);
    copy.clear();
    expect(copy.size).toBe(0);
    expect(Number.isNaN(copy.median)).toBe(true);
  });
});

describe('mulberry32', () => {
  it('is deterministic for a seed and stays in [0, 1)', () => {
    fc.assert(
      fc.property(fc.integer(), seed => {
        const a = mulberry32(seed);
        const b = mulberry32(seed);
        for (let index = 0; index < 20; index++) {
          const value = a();
          expect(value).toBe(b());
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThan(1);
        }
      }),
    );
  });

  it('drives a Gaussian with mean near 0 and spread near 1', () => {
    const normal = gaussian(mulberry32(9));
    const samples = Array.from({ length: 50_000 }, normal);
    const { mean, variance } = reference(samples);
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(Math.abs(variance - 1)).toBeLessThan(0.03);
  });
});
