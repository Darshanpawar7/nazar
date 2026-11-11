import { gaussian, mulberry32 } from './stats';

/**
 * Seeded, deterministic synthetic signals with ground-truth labels, for tests, demos and tuning thresholds.
 * Every function returns new arrays; nothing passed in is changed.
 */

export interface Labelled {
  readonly values: readonly number[];
  /** `true` where a reading is part of an injected anomaly. */
  readonly labels: readonly boolean[];
}

export interface SignalOptions {
  readonly length: number;
  readonly level?: number;
  /** Standard deviation of Gaussian noise. */
  readonly noise?: number;
  /** Change in level per reading. */
  readonly trend?: number;
  /** A sine wave added to the signal. */
  readonly season?: { readonly amplitude: number; readonly period: number };
  readonly seed?: number;
}

/** A clean signal: level, trend, a seasonal wave and Gaussian noise. No anomalies, so every label is false. */
export function signal(options: SignalOptions): Labelled {
  const { length, level = 0, noise = 1, trend = 0, season, seed = 1 } = options;
  const normal = gaussian(mulberry32(seed));
  const values = Array.from({ length }, (_, index) => {
    const wave = season ? season.amplitude * Math.sin((2 * Math.PI * index) / season.period) : 0;
    return level + trend * index + wave + noise * normal();
  });
  return { values, labels: values.map(() => false) };
}

function mark(series: Labelled, from: number, to: number, change: (value: number, offset: number) => number): Labelled {
  const start = Math.max(0, from);
  const end = Math.min(series.values.length, to);
  return {
    values: series.values.map((value, index) => (index >= start && index < end ? change(value, index - start) : value)),
    labels: series.labels.map((label, index) => label || (index >= start && index < end)),
  };
}

/** One reading pushed `size` away from where it was. */
export function spike(series: Labelled, at: number, size: number): Labelled {
  return mark(series, at, at + 1, value => value + size);
}

/** The level steps by `size` from reading `at` onwards (or for `length` readings). */
export function levelShift(series: Labelled, at: number, size: number, length = Infinity): Labelled {
  return mark(series, at, at + length, value => value + size);
}

/** The level drifts linearly up to `size` over `length` readings, then stays there. */
export function ramp(series: Labelled, at: number, length: number, size: number): Labelled {
  return mark(series, at, series.values.length, (value, offset) => value + size * Math.min(1, (offset + 1) / length));
}

/** The sensor freezes at the value it read at `at`, for `length` readings. */
export function stuck(series: Labelled, at: number, length: number): Labelled {
  const frozen = series.values[at] ?? 0;
  return mark(series, at, at + length, () => frozen);
}

// ---------------------------------------------------------------- scenarios

export interface Scenario extends Labelled {
  readonly id: ScenarioId;
  readonly title: string;
  readonly story: string;
  readonly unit: string;
  /** Milliseconds since the epoch for each reading. */
  readonly timestamps: readonly number[];
}

export type ScenarioId = 'water-flow-leak' | 'cold-room' | 'tank-stuck' | 'power-daily';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Scenario clocks start at midnight on 1 January 2026, UTC, so they are the same everywhere. */
const START = Date.UTC(2026, 0, 1);

function timestamps(length: number, step: number): number[] {
  return Array.from({ length }, (_, index) => START + index * step);
}

/** A flow sensor with a few bursts, then a slow leak: the level rises by about one standard deviation. */
export function waterFlowWithLeak(seed = 7): Scenario {
  const length = 600;
  let series = signal({ length, level: 12, noise: 0.6, seed });
  series = spike(series, 120, 4.2);
  series = spike(series, 260, -3.9);
  series = levelShift(series, 380, 0.7);
  return {
    ...series,
    id: 'water-flow-leak',
    title: 'Water flow with a slow leak',
    story:
      'A main line reads about 12 L/min. Two bursts, then a slow leak adds 0.7 L/min that never stands out on its own.',
    unit: 'L/min',
    timestamps: timestamps(length, MINUTE),
  };
}

/** A cold room at 4 °C: the door is left open and the temperature drifts up by 2 °C. */
export function coldRoomTemperature(seed = 11): Scenario {
  const length = 600;
  let series = signal({ length, level: 4, noise: 0.15, seed });
  series = spike(series, 150, 1.4);
  series = ramp(series, 360, 180, 2);
  return {
    ...series,
    id: 'cold-room',
    title: 'A cold-room door left open',
    story:
      'A cold store holds 4 °C. A brief spike when a crate goes in, then the door stays open and it warms by 2 °C over three hours.',
    unit: '°C',
    timestamps: timestamps(length, MINUTE),
  };
}

/** A tank level drifting gently while it drains and refills, until the sensor freezes. */
export function tankLevelStuckSensor(seed = 3): Scenario {
  const length = 600;
  let series = signal({ length, level: 62, noise: 0.25, season: { amplitude: 8, period: 240 }, seed });
  series = stuck(series, 330, 90);
  return {
    ...series,
    id: 'tank-stuck',
    title: 'A tank sensor that freezes',
    story:
      'A tank drains and refills twice a day. Then the level sensor sticks and reports the same reading for an hour and a half.',
    unit: '%',
    timestamps: timestamps(length, MINUTE),
  };
}

/** Hourly power draw with a daily pattern, and one night where something is left running at 3 a.m. */
export function powerDrawDaily(seed = 5): Scenario {
  const days = 21;
  const length = days * 24;
  const times = timestamps(length, HOUR);
  const normal = gaussian(mulberry32(seed));
  const daily = (hour: number) =>
    1.2 + 2.6 * Math.max(0, Math.sin(((hour - 6) / 24) * 2 * Math.PI)) + (hour >= 18 && hour < 23 ? 1.4 : 0);
  let series: Labelled = {
    values: times.map((_, index) => daily(index % 24) + 0.12 * normal()),
    labels: times.map(() => false),
  };
  const night = 17 * 24 + 3;
  series = levelShift(series, night, 2.8, 2);
  return {
    ...series,
    id: 'power-daily',
    title: 'Power draw at 3 a.m.',
    story:
      'A small office draws little at night and peaks in the evening. On day 18 something is left running at 3 a.m.: normal for 8 p.m., wrong for 3 a.m.',
    unit: 'kW',
    timestamps: times,
  };
}

export const SCENARIOS: Readonly<Record<ScenarioId, (seed?: number) => Scenario>> = {
  'water-flow-leak': waterFlowWithLeak,
  'cold-room': coldRoomTemperature,
  'tank-stuck': tankLevelStuckSensor,
  'power-daily': powerDrawDaily,
};
