import type { Verdict } from '../../src';
import { evaluate, runs } from '../../src/eval';
import { SCENARIOS, spike, type Labelled, type Scenario, type ScenarioId } from '../../src/synth';
import { highlight } from './code';
import { band, extent, grid, incidents, line, palette, prepare, rings, truth, xOf, yOf, type Frame } from './chart';
import { build, clampToParam, codeFor, DETECTORS, isDetectorId, SUGGESTED, specFor, type DetectorId } from './presets';

interface State {
  scenario: ScenarioId;
  detector: DetectorId;
  settings: Record<string, number>;
  alarmAfter: number;
  /** Spikes the visitor added by clicking the chart, as reading indices. */
  extra: number[];
}

const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];
const isScenarioId = (value: string): value is ScenarioId => (SCENARIO_IDS as string[]).includes(value);
const THROUGHPUT_READINGS = 200_000;
const MAX_EXTRA_SPIKES = 12;
const HASH = 'play';

function defaultsFor(scenario: ScenarioId): State {
  const detector = SUGGESTED[scenario];
  return { scenario, detector, settings: { ...specFor(detector).defaults }, alarmAfter: 1, extra: [] };
}

/** Reads the shared configuration from the address bar. Everything is checked; anything odd falls back. */
export function readHash(hash: string): State | null {
  const query = hash.replace(/^#/, '');
  if (!query.startsWith(`${HASH}?`)) return null;
  const params = new URLSearchParams(query.slice(HASH.length + 1));
  const scenario = params.get('s') ?? '';
  const detector = params.get('d') ?? '';
  if (!isScenarioId(scenario) || !isDetectorId(detector)) return null;
  const spec = specFor(detector);
  const settings = Object.fromEntries(
    spec.params.map(param => [
      param.key,
      clampToParam(param, Number(params.get(param.key) ?? spec.defaults[param.key])),
    ]),
  );
  const alarmAfter = Math.min(10, Math.max(1, Math.round(Number(params.get('n') ?? 1)) || 1));
  return { scenario, detector, settings, alarmAfter, extra: [] };
}

function writeHash(state: State): string {
  const params = new URLSearchParams({
    s: state.scenario,
    d: state.detector,
    ...Object.fromEntries(Object.entries(state.settings).map(([key, value]) => [key, String(value)])),
    n: String(state.alarmAfter),
  });
  return `#${HASH}?${params.toString()}`;
}

function withExtraSpikes(data: Scenario, extra: readonly number[]): Labelled {
  const size = 6 * standardDeviation(data.values);
  return extra.reduce<Labelled>((series, at) => spike(series, at, size), data);
}

function standardDeviation(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function el<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`The page is missing #${id}`);
  return element as T;
}

function metric(list: HTMLDListElement, label: string, value: string): void {
  const wrap = document.createElement('div');
  const term = document.createElement('dt');
  const detail = document.createElement('dd');
  term.textContent = label;
  detail.textContent = value;
  wrap.append(term, detail);
  list.append(wrap);
}

export function startPlayground(): void {
  const scenarioSelect = el<HTMLSelectElement>('scenario');
  const detectorSelect = el<HTMLSelectElement>('detector');
  const paramsBox = el<HTMLDivElement>('params');
  const persistInput = el<HTMLInputElement>('persist');
  const persistOut = el<HTMLOutputElement>('persist-out');
  const story = el<HTMLParagraphElement>('story');
  const canvas = el<HTMLCanvasElement>('play-canvas');
  const metrics = el<HTMLDListElement>('metrics');
  const code = el<HTMLElement>('play-code');
  const resetSpikes = el<HTMLButtonElement>('reset-spikes');

  let state: State = readHash(location.hash) ?? defaultsFor('water-flow-leak');
  let throughputTimer: ReturnType<typeof setTimeout> | undefined;
  let lastRun: { data: Labelled; scenario: Scenario; verdicts: Verdict[] } | null = null;

  for (const id of SCENARIO_IDS) scenarioSelect.add(new Option(SCENARIOS[id]().title, id));
  for (const spec of DETECTORS) detectorSelect.add(new Option(spec.name, spec.id));

  const renderParams = () => {
    paramsBox.replaceChildren();
    for (const param of specFor(state.detector).params) {
      const id = `param-${param.key}`;
      const field = document.createElement('div');
      field.className = 'field field--row';
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = param.label;
      const input = document.createElement('input');
      Object.assign(input, {
        type: 'range',
        id,
        min: String(param.min),
        max: String(param.max),
        step: String(param.step),
      });
      input.value = String(state.settings[param.key]);
      input.setAttribute('aria-describedby', `${id}-hint`);
      const output = document.createElement('output');
      output.htmlFor.add(id);
      output.textContent = String(state.settings[param.key]);
      const hint = document.createElement('p');
      hint.className = 'field__hint';
      hint.id = `${id}-hint`;
      hint.textContent = param.hint;
      input.addEventListener('input', () => {
        const value = clampToParam(param, Number(input.value));
        output.textContent = String(value);
        update({ settings: { ...state.settings, [param.key]: value } });
      });
      field.append(label, input, output, hint);
      paramsBox.append(field);
    }
  };

  const draw = () => {
    if (!lastRun) return;
    const surface = prepare(canvas);
    if (!surface) return;
    const colours = palette(canvas);
    const { context, width, height } = surface;
    const { data, verdicts } = lastRun;
    context.clearRect(0, 0, width, height);
    const range = extent(data.values);
    const frame: Frame = {
      left: 48,
      right: width - 10,
      top: 12,
      bottom: height - 22,
      ...range,
      count: data.values.length,
    };
    truth(surface, frame, colours, data.labels);
    grid(surface, frame, colours, 4);
    band(
      surface,
      frame,
      colours,
      verdicts.map(verdict => verdict.lower),
      verdicts.map(verdict => verdict.upper),
    );
    line(surface, frame, colours.signal, data.values, 1.25);
    const flagged = runs(verdicts.map(verdict => verdict.anomaly));
    incidents(surface, frame, colours, flagged);
    for (const run of flagged)
      rings(surface, colours, xOf(frame, run.start), yOf(frame, data.values[run.start] as number), 0);
  };

  const measureThroughput = (dd: HTMLElement) => {
    clearTimeout(throughputTimer);
    throughputTimer = setTimeout(() => {
      if (!lastRun) return;
      const detector = build(state.detector, state.settings, state.alarmAfter);
      const { values, timestamps } = lastRun.scenario;
      const started = performance.now();
      for (let index = 0; index < THROUGHPUT_READINGS; index++) {
        const at = index % values.length;
        detector.update(values[at] as number, timestamps[at]);
      }
      const seconds = (performance.now() - started) / 1000;
      dd.textContent = `${(THROUGHPUT_READINGS / seconds / 1e6).toFixed(1)} M/s`;
    }, 350);
  };

  const run = () => {
    const scenario = SCENARIOS[state.scenario]();
    const data = withExtraSpikes(scenario, state.extra);
    const detector = build(state.detector, state.settings, state.alarmAfter);
    const verdicts = data.values.map((value, index) => detector.update(value, scenario.timestamps[index]));
    lastRun = { data, scenario, verdicts };
    const result = evaluate(
      verdicts.map(verdict => verdict.anomaly),
      data.labels,
      { tolerance: 10 },
    );
    metrics.replaceChildren();
    metric(metrics, 'Caught', `${result.detected} of ${result.events}`);
    metric(metrics, 'False alarms', String(result.falseAlarms));
    metric(metrics, 'Precision', result.precision.toFixed(2));
    metric(metrics, 'Recall', result.recall.toFixed(2));
    metric(metrics, 'F1', result.f1.toFixed(2));
    metric(metrics, 'Delay, readings', Number.isNaN(result.meanDelay) ? '–' : result.meanDelay.toFixed(1));
    metric(metrics, 'Throughput', '…');
    const throughput = metrics.lastElementChild?.querySelector('dd');
    if (throughput) measureThroughput(throughput);
    story.textContent = scenario.story;
    highlight(code, codeFor(state.detector, state.settings, state.alarmAfter));
    draw();
  };

  const update = (patch: Partial<State>) => {
    state = { ...state, ...patch };
    history.replaceState(null, '', writeHash(state));
    run();
  };

  const syncControls = () => {
    scenarioSelect.value = state.scenario;
    detectorSelect.value = state.detector;
    persistInput.value = String(state.alarmAfter);
    persistOut.textContent = state.alarmAfter === 1 ? '1 reading' : `${state.alarmAfter} readings in a row`;
    renderParams();
  };

  scenarioSelect.addEventListener('change', () => {
    if (!isScenarioId(scenarioSelect.value)) return;
    state = defaultsFor(scenarioSelect.value);
    syncControls();
    update({});
  });
  detectorSelect.addEventListener('change', () => {
    if (!isDetectorId(detectorSelect.value)) return;
    state = { ...state, detector: detectorSelect.value, settings: { ...specFor(detectorSelect.value).defaults } };
    syncControls();
    update({});
  });
  persistInput.addEventListener('input', () => {
    const alarmAfter = Math.min(10, Math.max(1, Number(persistInput.value) || 1));
    persistOut.textContent = alarmAfter === 1 ? '1 reading' : `${alarmAfter} readings in a row`;
    update({ alarmAfter });
  });
  canvas.addEventListener('click', event => {
    if (!lastRun || state.extra.length >= MAX_EXTRA_SPIKES) return;
    const box = canvas.getBoundingClientRect();
    const fraction = (event.clientX - box.left - 48) / (box.width - 58);
    const at = Math.round(Math.min(1, Math.max(0, fraction)) * (lastRun.data.values.length - 1));
    update({ extra: [...state.extra, at] });
  });
  resetSpikes.addEventListener('click', () => update({ extra: [] }));
  new ResizeObserver(draw).observe(canvas);
  document.addEventListener('themechange', draw);

  syncControls();
  run();
}
