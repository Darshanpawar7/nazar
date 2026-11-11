import { cusum, flatline, hampel, pageHinkley, persist, seasonal, zscore, type Detector } from '../../src';
import type { ScenarioId } from '../../src/synth';

/** One adjustable setting of a detector, as a slider. */
export interface Param {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly hint: string;
}

export type DetectorId = 'zscore' | 'hampel' | 'cusum' | 'pageHinkley' | 'seasonal' | 'flatline';

export interface DetectorSpec {
  readonly id: DetectorId;
  readonly name: string;
  readonly catches: string;
  readonly cost: string;
  readonly params: readonly Param[];
  readonly defaults: Readonly<Record<string, number>>;
  readonly make: (settings: Readonly<Record<string, number>>) => Detector;
}

export const DETECTORS: readonly DetectorSpec[] = [
  {
    id: 'zscore',
    name: 'zscore',
    catches: 'Sudden spikes on a stable signal.',
    cost: 'O(1) time and memory',
    params: [
      { key: 'threshold', label: 'Threshold', min: 1.5, max: 6, step: 0.1, hint: 'standard deviations' },
      { key: 'alpha', label: 'Smoothing', min: 0.005, max: 0.3, step: 0.005, hint: 'how fast the baseline moves' },
    ],
    defaults: { threshold: 3, alpha: 0.05 },
    make: s => zscore({ threshold: s.threshold, alpha: s.alpha }),
  },
  {
    id: 'hampel',
    name: 'hampel',
    catches: 'Spikes, robustly: one outlier cannot hide the next.',
    cost: 'O(window) time and memory',
    params: [
      { key: 'window', label: 'Window', min: 11, max: 151, step: 2, hint: 'readings in the median' },
      { key: 'threshold', label: 'Threshold', min: 1.5, max: 6, step: 0.1, hint: 'scaled MADs' },
    ],
    defaults: { window: 51, threshold: 3 },
    make: s => hampel({ window: s.window, threshold: s.threshold }),
  },
  {
    id: 'cusum',
    name: 'cusum',
    catches: 'Small sustained shifts: the slow leak.',
    cost: 'O(1) time and memory',
    params: [
      { key: 'k', label: 'Slack k', min: 0, max: 2, step: 0.1, hint: 'shifts smaller than this are ignored' },
      { key: 'h', label: 'Threshold h', min: 1, max: 15, step: 0.5, hint: 'how much evidence to collect' },
    ],
    defaults: { k: 0.5, h: 5 },
    make: s => cusum({ k: s.k, h: s.h }),
  },
  {
    id: 'pageHinkley',
    name: 'pageHinkley',
    catches: 'Gradual drift, such as a sensor losing calibration.',
    cost: 'O(1) time and memory',
    params: [
      { key: 'delta', label: 'Tolerance δ', min: 0, max: 0.2, step: 0.005, hint: 'units of the signal' },
      { key: 'lambda', label: 'Threshold λ', min: 1, max: 60, step: 1, hint: 'accumulated evidence' },
    ],
    defaults: { delta: 0.01, lambda: 5 },
    make: s => pageHinkley({ delta: s.delta, lambda: s.lambda }),
  },
  {
    id: 'seasonal',
    name: 'seasonal',
    catches: 'Readings wrong for the time of day.',
    cost: 'O(1) time, O(slots) memory',
    params: [
      { key: 'threshold', label: 'Threshold', min: 1.5, max: 6, step: 0.1, hint: 'standard deviations' },
      { key: 'buckets', label: 'Slots per day', min: 6, max: 48, step: 6, hint: 'how finely the day is cut' },
    ],
    defaults: { threshold: 3, buckets: 24 },
    make: s => seasonal({ threshold: s.threshold, buckets: s.buckets }),
  },
  {
    id: 'flatline',
    name: 'flatline',
    catches: 'A stuck sensor that repeats one reading.',
    cost: 'O(1) time and memory',
    params: [
      { key: 'samples', label: 'Readings', min: 3, max: 60, step: 1, hint: 'in a row before it counts as stuck' },
      {
        key: 'tolerance',
        label: 'Tolerance',
        min: 0,
        max: 0.5,
        step: 0.01,
        hint: 'change that still counts as the same',
      },
    ],
    defaults: { samples: 10, tolerance: 0 },
    make: s => flatline({ samples: s.samples, tolerance: s.tolerance }),
  },
];

/** The detector each scenario was made to show off. */
export const SUGGESTED: Readonly<Record<ScenarioId, DetectorId>> = {
  'water-flow-leak': 'cusum',
  'cold-room': 'pageHinkley',
  'tank-stuck': 'flatline',
  'power-daily': 'seasonal',
};

export function specFor(id: DetectorId): DetectorSpec {
  return DETECTORS.find(spec => spec.id === id) ?? (DETECTORS[0] as DetectorSpec);
}

export function isDetectorId(value: string): value is DetectorId {
  return DETECTORS.some(spec => spec.id === value);
}

/** Clamps a value to a slider's range and snaps it to the slider's step. */
export function clampToParam(param: Param, value: number): number {
  if (!Number.isFinite(value)) return param.min;
  const snapped = Math.round((value - param.min) / param.step) * param.step + param.min;
  return Number(Math.min(param.max, Math.max(param.min, snapped)).toFixed(4));
}

export function build(id: DetectorId, settings: Readonly<Record<string, number>>, alarmAfter: number): Detector {
  const detector = specFor(id).make(settings);
  return alarmAfter > 1 ? persist(detector, { min: alarmAfter }) : detector;
}

/** The TypeScript that sets up exactly this configuration. */
export function codeFor(id: DetectorId, settings: Readonly<Record<string, number>>, alarmAfter: number): string {
  const spec = specFor(id);
  const options = spec.params.map(param => `${param.key}: ${settings[param.key]}`).join(', ');
  const factory = `${spec.id}({ ${options} })`;
  const imports = alarmAfter > 1 ? `{ persist, ${spec.id} }` : `{ ${spec.id} }`;
  const made = alarmAfter > 1 ? `persist(${factory}, { min: ${alarmAfter} })` : factory;
  const timed = id === 'seasonal' ? 'reading.value, reading.time' : 'reading.value';
  return [
    `import ${imports} from 'nazar-js';`,
    '',
    `const detector = ${made};`,
    '',
    'for (const reading of readings) {',
    `  const verdict = detector.update(${timed});`,
    '  if (verdict.anomaly) alert(reading, verdict.reason, verdict.score);',
    '}',
  ].join('\n');
}
