import type { Detector } from '../../src';
import { levelShift, powerDrawDaily, ramp, signal, spike, tankLevelStuckSensor, type Labelled } from '../../src/synth';
import { runs } from '../../src/eval';
import { extent, incidents, line, palette, prepare, rings, truth, xOf, yOf, type Frame } from './chart';
import { DETECTORS, type DetectorId } from './presets';

interface Example extends Labelled {
  readonly timestamps?: readonly number[];
}

/** A short, labelled series that shows off what each detector is for. */
function exampleFor(id: DetectorId): Example {
  const base = signal({ length: 220, level: 10, noise: 0.5, seed: 31 });
  switch (id) {
    case 'zscore':
      return spike(spike(base, 90, 3.6), 170, -3.4);
    case 'hampel':
      return [120, 121, 122, 123].reduce((series, at) => spike(series, at, 4), spike(base, 60, -3));
    case 'cusum':
      return levelShift(base, 120, 0.55);
    case 'pageHinkley':
      return ramp(signal({ length: 220, level: 10, noise: 0.12, seed: 32 }), 110, 90, 1.4);
    case 'seasonal': {
      const power = powerDrawDaily();
      const from = 15 * 24;
      return {
        values: power.values.slice(from, from + 96),
        labels: power.labels.slice(from, from + 96),
        timestamps: power.timestamps.slice(from, from + 96),
      };
    }
    case 'flatline': {
      const tank = tankLevelStuckSensor();
      return { values: tank.values.slice(250, 470), labels: tank.labels.slice(250, 470) };
    }
  }
}

/** Seasonal needs history: it learns from the days before the window it shows. */
function primed(id: DetectorId, detector: Detector): Detector {
  if (id !== 'seasonal') return detector;
  const power = powerDrawDaily();
  for (let index = 0; index < 15 * 24; index++) detector.update(power.values[index] as number, power.timestamps[index]);
  return detector;
}

function drawCard(canvas: HTMLCanvasElement, example: Example, flags: readonly boolean[]): void {
  const surface = prepare(canvas);
  if (!surface) return;
  const colours = palette(canvas);
  surface.context.clearRect(0, 0, surface.width, surface.height);
  const frame: Frame = {
    left: 2,
    right: surface.width - 2,
    top: 8,
    bottom: surface.height - 14,
    ...extent(example.values, 0.12),
    count: example.values.length,
  };
  truth(surface, frame, colours, example.labels);
  line(surface, frame, colours.signal, example.values, 1.25);
  const flagged = runs(flags);
  incidents(surface, frame, colours, flagged);
  for (const run of flagged)
    rings(surface, colours, xOf(frame, run.start), yOf(frame, example.values[run.start] as number), 0, 0.9);
}

export function renderGallery(container: HTMLElement): void {
  const cards = DETECTORS.map(spec => {
    const example = exampleFor(spec.id);
    const detector = primed(spec.id, spec.make(spec.defaults));
    const flags = example.values.map((value, index) => detector.update(value, example.timestamps?.[index]).anomaly);

    const card = document.createElement('article');
    card.className = 'card';
    const title = document.createElement('h3');
    const name = document.createElement('code');
    name.textContent = `${spec.name}()`;
    title.append(name);
    const catches = document.createElement('p');
    catches.textContent = spec.catches;
    const canvas = document.createElement('canvas');
    canvas.className = 'card__canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${spec.name} on an example: ${flags.filter(Boolean).length} readings flagged.`);
    const cost = document.createElement('p');
    cost.className = 'card__cost';
    cost.textContent = spec.cost;
    card.append(title, catches, canvas, cost);
    return { card, canvas, example, flags };
  });
  container.replaceChildren(...cards.map(item => item.card));
  const redraw = () => cards.forEach(item => drawCard(item.canvas, item.example, item.flags));
  new ResizeObserver(redraw).observe(container);
  document.addEventListener('themechange', redraw);
  redraw();
}
