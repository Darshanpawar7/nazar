import { cusum, ensemble, hampel, type Detector, type Verdict } from '../../src';
import { gaussian, mulberry32 } from '../../src/stats';
import { runs } from '../../src/eval';
import { band, grid, incidents, line, palette, prepare, rings, xOf, yOf, type Frame } from './chart';

/** How many readings the monitor shows at once. */
const VISIBLE = 240;
/** Readings per second while the stream runs. */
const RATE = 18;
const RIPPLE_MS = 700;
const LOG_LENGTH = 4;
const LEVEL = 12;
const NOISE = 0.6;

interface Sample {
  value: number;
  verdict: Verdict;
  /** When this reading opened a new incident, if it did: the moment its ring started to ripple. */
  openedAt: number | null;
  clock: string;
}

/**
 * The simulated sensor. Every so often it injects trouble: a burst, or a slow leak that lasts a while.
 * Only this generator's own counters change; nothing outside it is touched.
 */
function sensor(seed: number) {
  const normal = gaussian(mulberry32(seed));
  let tick = 0;
  let leakUntil = -1;
  return () => {
    tick += 1;
    let value = LEVEL + NOISE * normal() + 0.35 * Math.sin(tick / 40);
    const phase = tick % 260;
    if (phase === 120) value += 4.5 * (tick % 520 === 120 ? 1 : -1);
    if (phase === 200) leakUntil = tick + 150;
    if (tick < leakUntil) value += 0.9;
    return value;
  };
}

function clockFor(index: number): string {
  const seconds = 6 * 3600 + 30 * 60 + index;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(seconds / 3600) % 24)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

export function startHero(
  canvas: HTMLCanvasElement,
  log: HTMLOListElement,
  toggle: HTMLButtonElement,
  status: HTMLElement,
): void {
  const detector: Detector = ensemble([hampel(), cusum()]);
  const next = sensor(17);
  let samples: Sample[] = [];
  let produced = 0;
  let running = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let visible = true;
  let carry = 0;
  let last = performance.now();

  const push = (now: number) => {
    const value = next();
    const verdict = detector.update(value);
    const opens = verdict.anomaly && !(samples.at(-1)?.verdict.anomaly ?? false);
    const sample: Sample = { value, verdict, openedAt: opens ? now : null, clock: clockFor(produced) };
    produced += 1;
    samples = [...samples.slice(-(VISIBLE - 1)), sample];
    // One log line per incident, not one per flagged reading.
    if (opens) {
      const item = document.createElement('li');
      item.textContent = `${sample.clock}  ${verdict.reason ?? 'anomaly'} detected  score ${verdict.score.toFixed(1)}`;
      log.prepend(item);
      while (log.children.length > LOG_LENGTH) log.lastElementChild?.remove();
    }
  };

  // Fill the screen before the first frame, so the monitor never starts empty.
  for (let index = 0; index < VISIBLE + 380; index++) push(-Infinity);

  const draw = (now: number) => {
    const surface = prepare(canvas);
    if (!surface) return;
    const colours = palette(canvas);
    const { context, width, height } = surface;
    context.clearRect(0, 0, width, height);
    const values = samples.map(sample => sample.value);
    const frame: Frame = {
      left: 44,
      right: width - 12,
      top: 14,
      bottom: height - 22,
      min: LEVEL - 4,
      max: LEVEL + 6,
      count: VISIBLE,
    };
    grid(surface, frame, colours, 4);
    const offset = VISIBLE - samples.length;
    const lower = Array<number | undefined>(offset).concat(samples.map(sample => sample.verdict.lower));
    const upper = Array<number | undefined>(offset).concat(samples.map(sample => sample.verdict.upper));
    band(surface, frame, colours, lower, upper);
    line(surface, frame, colours.signal, Array<number>(offset).fill(Number.NaN).concat(values));
    const flagged = samples.map(sample => sample.verdict.anomaly);
    const open = runs(flagged).map(run => ({ start: run.start + offset, end: run.end + offset }));
    incidents(surface, frame, colours, open);
    // A ring marks where each incident began; a new one ripples once as it arrives.
    for (const run of runs(flagged)) {
      const sample = samples[run.start];
      if (!sample) continue;
      const age = sample.openedAt === null ? Infinity : now - sample.openedAt;
      const grow = age < RIPPLE_MS ? age / RIPPLE_MS : 0;
      rings(surface, colours, xOf(frame, offset + run.start), yOf(frame, sample.value), grow);
    }
  };

  // At most one animation frame is ever pending, however many events ask for one.
  let requested = false;
  const schedule = () => {
    if (requested) return;
    requested = true;
    requestAnimationFrame(loop);
  };

  function loop(now: number): void {
    requested = false;
    if (running && visible) {
      carry += ((now - last) / 1000) * RATE;
      while (carry >= 1) {
        push(now);
        carry -= 1;
      }
    }
    last = now;
    draw(now);
    if (running && visible) schedule();
  }

  const setRunning = (value: boolean) => {
    running = value;
    toggle.textContent = running ? 'Pause' : 'Play';
    status.textContent = running ? 'live' : 'paused';
    status.classList.toggle('is-paused', !running);
    last = performance.now();
    if (running) schedule();
  };

  toggle.addEventListener('click', () => setRunning(!running));

  // Stop drawing when nobody can see it: scrolled away, or the tab is in the background.
  new IntersectionObserver(entries => {
    const wasVisible = visible;
    visible = entries.some(entry => entry.isIntersecting) && document.visibilityState === 'visible';
    if (visible && !wasVisible && running) {
      last = performance.now();
      schedule();
    }
  }).observe(canvas);
  document.addEventListener('visibilitychange', () => {
    visible = document.visibilityState === 'visible';
    if (visible && running) {
      last = performance.now();
      schedule();
    }
  });
  new ResizeObserver(() => draw(performance.now())).observe(canvas);
  document.addEventListener('themechange', () => draw(performance.now()));

  setRunning(running);
  draw(performance.now());
}
