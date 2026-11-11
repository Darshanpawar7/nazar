import { describe, expect, it } from 'vitest';
import { evaluate, runs } from '../src/eval';
import { levelShift, ramp, SCENARIOS, signal, spike, stuck, type ScenarioId } from '../src/synth';

describe('synthetic signals', () => {
  it('is the same every time for the same seed, and different for another', () => {
    expect(signal({ length: 50, seed: 4 })).toEqual(signal({ length: 50, seed: 4 }));
    expect(signal({ length: 50, seed: 4 }).values).not.toEqual(signal({ length: 50, seed: 5 }).values);
  });

  it('builds level, trend and season', () => {
    const clean = signal({ length: 101, level: 10, noise: 0, trend: 0.1, season: { amplitude: 2, period: 4 } });
    expect(clean.values[0]).toBeCloseTo(10, 9);
    expect(clean.values[1]).toBeCloseTo(10 + 0.1 + 2, 9);
    expect(clean.values[100]).toBeCloseTo(20, 9);
  });

  it('injects anomalies with labels, and never changes the series it was given', () => {
    const clean = signal({ length: 20, noise: 0 });
    const frozen = JSON.stringify(clean);
    const spiked = spike(clean, 5, 3);
    expect(spiked.values[5]).toBe(3);
    expect(spiked.labels.filter(Boolean)).toHaveLength(1);
    expect(levelShift(clean, 10, 2, 3).labels.filter(Boolean)).toHaveLength(3);
    expect(levelShift(clean, 10, 2).values.slice(10)).toEqual(Array(10).fill(2));
    expect(ramp(clean, 0, 4, 4).values.slice(0, 5)).toEqual([1, 2, 3, 4, 4]);
    expect(stuck(spike(clean, 2, 7), 2, 3).values.slice(2, 6)).toEqual([7, 7, 7, 0]);
    expect(spike(clean, 99, 1)).toEqual(clean);
    expect(JSON.stringify(clean)).toBe(frozen);
  });

  it.each(Object.keys(SCENARIOS) as ScenarioId[])(
    'builds the %s scenario with matching lengths and some labels',
    id => {
      const scenario = SCENARIOS[id]();
      expect(scenario.id).toBe(id);
      expect(scenario.values.length).toBe(scenario.labels.length);
      expect(scenario.timestamps.length).toBe(scenario.values.length);
      expect(scenario.labels.some(Boolean)).toBe(true);
      expect(scenario.values.every(Number.isFinite)).toBe(true);
      expect(scenario.title.length).toBeGreaterThan(5);
      expect(SCENARIOS[id]()).toEqual(scenario);
    },
  );
});

describe('evaluate', () => {
  const T = true;
  const F = false;

  it('finds the runs in a list of flags', () => {
    expect(runs([F, T, T, F, T])).toEqual([
      { start: 1, end: 3 },
      { start: 4, end: 5 },
    ]);
    expect(runs([])).toEqual([]);
  });

  it('scores by events: one hit per event, one false alarm per stray run', () => {
    const labels = [F, F, T, T, T, F, F, F, T, T, F, F];
    const flagged = [F, F, F, T, T, F, T, F, F, F, F, F];
    expect(evaluate(flagged, labels)).toEqual({
      detected: 1,
      events: 2,
      falseAlarms: 1,
      precision: 0.5,
      recall: 0.5,
      f1: 0.5,
      meanDelay: 1,
    });
  });

  it('counts a flag shortly after an event as catching it, within the tolerance', () => {
    const labels = [F, T, F, F, F];
    const late = [F, F, F, T, F];
    expect(evaluate(late, labels).recall).toBe(0);
    expect(evaluate(late, labels, { tolerance: 2 })).toMatchObject({ recall: 1, precision: 1, meanDelay: 2 });
  });

  it('handles the empty cases without dividing by zero', () => {
    expect(evaluate([F, F], [F, F])).toMatchObject({ precision: 0, recall: 0, f1: 0 });
    expect(Number.isNaN(evaluate([F, F], [T, F]).meanDelay)).toBe(true);
    expect(() => evaluate([F], [F, F])).toThrow('same length');
  });
});
