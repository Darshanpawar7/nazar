import { describe, expect, it } from 'vitest';
import { cusum, flatline, hampel, pageHinkley, range, rateOfChange, seasonal, zscore, type Detector } from '../src';
import { levelShift, powerDrawDaily, ramp, signal, spike, tankLevelStuckSensor } from '../src/synth';

const flags = (detector: Detector, values: readonly number[], times?: readonly number[]) =>
  values.map((value, index) => detector.update(value, times?.[index]).anomaly);

const rate = (marks: readonly boolean[]) => marks.filter(Boolean).length / Math.max(1, marks.length);

/** Gaussian noise with a 6-sigma spike every 100 readings, starting at 150. */
function spiky(seed: number) {
  let series = signal({ length: 3000, level: 50, noise: 1, seed });
  for (let at = 150; at < 3000; at += 100) series = spike(series, at, at % 200 === 50 ? 6 : -6);
  return series;
}

describe('zscore', () => {
  it('is not ready, and never flags, during warm-up', () => {
    const detector = zscore({ warmup: 10 });
    const verdicts = [1, 2, 300, 4, 5].map(value => detector.update(value));
    expect(verdicts.every(verdict => !verdict.ready && !verdict.anomaly)).toBe(true);
  });

  it('flags a 6-sigma spike and stays quiet on plain noise', () => {
    const series = spiky(1);
    const marks = flags(zscore(), series.values);
    const caught = marks.filter((mark, index) => mark && series.labels[index]).length;
    const spikes = series.labels.filter(Boolean).length;
    const falseAlarms = marks.filter((mark, index) => mark && !series.labels[index]).length;
    expect(caught / spikes).toBeGreaterThanOrEqual(0.95);
    expect(falseAlarms / (marks.length - spikes)).toBeLessThan(0.01);
  });

  it('does not learn from a flagged reading, so the next normal reading is not affected', () => {
    const detector = zscore({ warmup: 20 });
    for (let index = 0; index < 40; index++) detector.update(10 + (index % 2) * 0.2);
    const flagged = detector.update(500);
    expect(flagged.reason).toBe('spike');
    expect(detector.update(10.1).expected).toBe(flagged.expected);
  });

  it('reports a band around the expected value', () => {
    const detector = zscore({ warmup: 5, threshold: 2 });
    [1, 3, 1, 3, 1].forEach(value => detector.update(value));
    const verdict = detector.update(2);
    expect(verdict.lower).toBeLessThan(2);
    expect(verdict.upper).toBeGreaterThan(2);
    expect(verdict.anomaly).toBe(false);
  });

  it('treats any change from a perfectly constant baseline as anomalous, with a capped score', () => {
    const detector = zscore({ warmup: 3 });
    [5, 5, 5].forEach(value => detector.update(value));
    expect(detector.update(5).score).toBe(0);
    expect(detector.update(5.001)).toMatchObject({ anomaly: true, score: 1e6 });
  });

  it('skips readings that are not finite numbers, without changing its state', () => {
    const detector = zscore({ warmup: 3 });
    [1, 2, 3].forEach(value => detector.update(value));
    const before = JSON.stringify(detector.snapshot().state);
    for (const value of [Number.NaN, Infinity, -Infinity])
      expect(detector.update(value)).toEqual({ anomaly: false, score: 0, ready: false });
    expect(detector.skipped).toBe(3);
    expect(JSON.stringify({ ...detector.snapshot().state, skipped: 0 })).toBe(
      JSON.stringify({ ...JSON.parse(before), skipped: 0 }),
    );
  });

  it('stays numerically stable over a million updates on a large offset', () => {
    const detector = zscore({ alpha: 0.001 });
    const noise = signal({ length: 1_000_000, level: 1e9, noise: 0.5, seed: 3 }).values;
    let last = detector.update(noise[0] as number);
    for (const value of noise) last = detector.update(value);
    expect(Number.isFinite(last.score)).toBe(true);
    expect((last.upper ?? 0) - (last.lower ?? 0)).toBeGreaterThan(0);
    expect((last.upper ?? 0) - (last.lower ?? 0)).toBeLessThan(10);
  });

  it('explains bad settings in plain words', () => {
    expect(() => zscore({ alpha: 1.5 })).toThrow('zscore: alpha must be between 0 and 1');
    expect(() => zscore({ threshold: -1 })).toThrow('zscore: threshold must be a positive number');
    expect(() => zscore({ warmup: 1 })).toThrow('zscore: warmup must be a whole number from 2');
    expect(() => zscore({ adapt: 'sometimes' as never })).toThrow('adapt must be "normal-only", "always" or "never"');
  });
});

describe('hampel', () => {
  it('catches at least 95% of 6-sigma spikes with under 1% false alarms', () => {
    const series = spiky(2);
    const marks = flags(hampel(), series.values);
    const spikes = series.labels.filter(Boolean).length;
    const caught = marks.filter((mark, index) => mark && series.labels[index]).length;
    const falseAlarms = marks.filter((mark, index) => mark && !series.labels[index]).length;
    expect(caught / spikes).toBeGreaterThanOrEqual(0.95);
    expect(falseAlarms / (marks.length - spikes)).toBeLessThan(0.01);
  });

  it('is not fooled by a burst of outliers the way a mean-based detector is', () => {
    let series = signal({ length: 400, level: 0, noise: 1, seed: 8 });
    for (let at = 200; at < 205; at++) series = spike(series, at, 40);
    const robust = flags(hampel({ window: 51 }), series.values).slice(200, 205);
    expect(robust.every(Boolean)).toBe(true);
  });

  it('accepts a minimum spread for quantised sensors', () => {
    const detector = hampel({ window: 5, minSpread: 0.5 });
    [10, 10, 10, 10, 10].forEach(value => detector.update(value));
    expect(detector.update(11).anomaly).toBe(false);
    expect(detector.update(12).anomaly).toBe(true);
  });

  it('refuses an even window', () => {
    expect(() => hampel({ window: 10 })).toThrow('hampel: window must be an odd whole number');
  });
});

describe('cusum', () => {
  const base = signal({ length: 1200, level: 20, noise: 1, seed: 21 });
  const shifted = levelShift(base, 600, 1);

  it('catches a sustained one-sigma shift quickly, which a 3-sigma z-score almost never notices', () => {
    const marks = flags(cusum(), shifted.values);
    const firstAlarm = marks.findIndex((mark, index) => mark && index >= 600);
    expect(firstAlarm).toBeGreaterThanOrEqual(600);
    expect(firstAlarm - 600).toBeLessThan(40);
    expect(rate(marks.slice(0, 600))).toBeLessThan(0.02);
    expect(rate(flags(zscore(), shifted.values).slice(600))).toBeLessThan(0.05);
  });

  it('keeps reporting a leak when it does not learn from it, and forgets it when it does', () => {
    const remembers = flags(cusum({ adapt: 'normal-only' }), shifted.values);
    const forgets = flags(cusum({ adapt: 'always', alpha: 0.05 }), shifted.values);
    expect(rate(remembers.slice(900))).toBeGreaterThan(0.9);
    expect(rate(forgets.slice(900))).toBeLessThan(0.2);
  });

  it('recovers after the shift ends, because its sums are capped', () => {
    const temporary = levelShift(base, 600, 2, 200);
    const marks = flags(cusum(), temporary.values);
    expect(rate(marks.slice(650, 800))).toBeGreaterThan(0.9);
    expect(rate(marks.slice(900))).toBeLessThan(0.02);
  });

  it('works on a perfectly constant baseline', () => {
    const detector = cusum({ warmup: 3 });
    [4, 4, 4].forEach(value => detector.update(value));
    expect(detector.update(4).anomaly).toBe(false);
    expect(detector.update(5).anomaly).toBe(true);
  });
});

describe('pageHinkley', () => {
  it('notices a slow drift and is quiet on a stable signal', () => {
    const stable = signal({ length: 800, level: 4, noise: 0.15, seed: 4 });
    const drifting = ramp(stable, 400, 200, 2);
    const quiet = flags(pageHinkley({ delta: 0.01, lambda: 5 }), stable.values);
    const noisy = flags(pageHinkley({ delta: 0.01, lambda: 5 }), drifting.values);
    expect(rate(quiet)).toBe(0);
    expect(noisy.findIndex((mark, index) => mark && index >= 400)).toBeLessThan(520);
  });

  it('watches both directions', () => {
    const falling = ramp(signal({ length: 600, level: 0, noise: 0.1, seed: 6 }), 300, 100, -3);
    expect(flags(pageHinkley({ delta: 0.01, lambda: 5 }), falling.values).some(Boolean)).toBe(true);
  });
});

describe('seasonal', () => {
  it('flags 3 a.m. power draw that would be normal in the evening', () => {
    const data = powerDrawDaily();
    const marks = flags(seasonal(), data.values, data.timestamps);
    const night = 17 * 24 + 3;
    expect(marks[night]).toBe(true);
    expect(rate(marks.filter((_, index) => !data.labels[index] && index > 24 * 4))).toBeLessThan(0.02);
    const global = flags(zscore(), data.values);
    expect(global[night]).toBe(false);
  });

  it('skips readings without a timestamp', () => {
    const detector = seasonal();
    expect(detector.update(5).ready).toBe(false);
    expect(detector.skipped).toBe(1);
  });

  it('places timestamps before 1970 in the right slot', () => {
    const detector = seasonal({ period: 24, buckets: 24, warmup: 1 });
    detector.update(1, -1);
    expect(detector.snapshot().state.counts).toEqual([...Array(23).fill(0), 1]);
  });
});

describe('flatline', () => {
  it('flags a stuck tank sensor and nothing else', () => {
    const data = tankLevelStuckSensor();
    const marks = flags(flatline({ samples: 10, tolerance: 0 }), data.values);
    expect(marks.slice(345, 420).every(Boolean)).toBe(true);
    expect(marks.some((mark, index) => mark && !data.labels[index])).toBe(false);
  });

  it('treats small wobbles within the tolerance as the same reading', () => {
    const detector = flatline({ samples: 3, tolerance: 0.1 });
    const verdicts = [5, 5.05, 4.98, 5.02, 5.3].map(value => detector.update(value));
    expect(verdicts.map(verdict => verdict.anomaly)).toEqual([false, false, false, true, false]);
  });
});

describe('range and rateOfChange', () => {
  it('flags physically impossible readings, with a score that grows with the excess', () => {
    const humidity = range({ min: 0, max: 100 });
    expect(humidity.update(50).score).toBe(0);
    expect(humidity.update(100)).toMatchObject({ anomaly: false, score: 1 });
    expect(humidity.update(150)).toMatchObject({ anomaly: true, score: 1.5, reason: 'out-of-range' });
    expect(() => range({ min: 5, max: 5 })).toThrow('range: min and max');
  });

  it('flags impossible jumps per reading', () => {
    const detector = rateOfChange({ maxDelta: 2 });
    expect(detector.update(10).ready).toBe(false);
    expect(detector.update(11.5).anomaly).toBe(false);
    expect(detector.update(20)).toMatchObject({ anomaly: true, reason: 'rate' });
  });

  it('scales the allowance with time when sampling is irregular', () => {
    const detector = rateOfChange({ maxDelta: 1, per: 'second' });
    detector.update(0, 0);
    expect(detector.update(5, 10_000).anomaly).toBe(false); // 5 units in 10 s is fine
    expect(detector.update(10, 11_000).anomaly).toBe(true); // 5 units in 1 s is not
    expect(detector.update(10, 11_000).anomaly).toBe(false); // the same instant: nothing to judge
    expect(detector.update(1, Number.NaN).ready).toBe(false);
    expect(detector.skipped).toBe(1);
  });

  it('refuses a missing allowance', () => {
    expect(() => rateOfChange({} as never)).toThrow('rateOfChange: maxDelta must be a positive number');
    expect(() => rateOfChange({ maxDelta: 1, per: 'hour' as never })).toThrow('per must be one of');
  });
});

describe('reset', () => {
  it('forgets what every detector has learned', () => {
    const detectors = [
      zscore(),
      hampel({ window: 3 }),
      cusum(),
      pageHinkley(),
      seasonal(),
      flatline(),
      range({ min: 0, max: 1 }),
      rateOfChange({ maxDelta: 1 }),
    ];
    for (const detector of detectors) {
      const fresh = JSON.stringify(detector.snapshot());
      for (let index = 0; index < 60; index++) detector.update(Math.sin(index) * 3, index * 3_600_000);
      detector.update(Number.NaN);
      detector.reset();
      expect(JSON.stringify(detector.snapshot())).toBe(fresh);
    }
  });
});
