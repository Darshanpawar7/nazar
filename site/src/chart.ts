/** Canvas drawing for the site's instruments: crisp at any pixel density, styled from CSS custom properties. */

export interface Palette {
  readonly grid: string;
  readonly tick: string;
  readonly signal: string;
  readonly band: string;
  readonly bandEdge: string;
  readonly flag: string;
  readonly truth: string;
  readonly bg: string;
}

/** Reads the chart colours from the current theme's custom properties. */
export function palette(element: Element): Palette {
  const style = getComputedStyle(element);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    grid: read('--chart-grid'),
    tick: read('--chart-tick'),
    signal: read('--chart-signal'),
    band: read('--chart-band'),
    bandEdge: read('--chart-band-edge'),
    flag: read('--chart-flag'),
    truth: read('--chart-truth'),
    bg: read('--chart-bg'),
  };
}

export interface Surface {
  readonly context: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
}

/** Sizes the canvas backing store to its CSS box times the device pixel ratio, and returns a context in CSS pixels. */
export function prepare(canvas: HTMLCanvasElement): Surface | null {
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  const width = Math.max(1, Math.round(canvas.clientWidth));
  const height = Math.max(1, Math.round(canvas.clientHeight));
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width, height };
}

export interface Frame {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly min: number;
  readonly max: number;
  readonly count: number;
}

export const xOf = (frame: Frame, index: number): number =>
  frame.left + (frame.count <= 1 ? 0 : (index / (frame.count - 1)) * (frame.right - frame.left));

export const yOf = (frame: Frame, value: number): number =>
  frame.bottom - ((value - frame.min) / (frame.max - frame.min || 1)) * (frame.bottom - frame.top);

/** A value range with a little headroom, ignoring anything that is not a finite number. */
export function extent(values: readonly number[], pad = 0.08): { min: number; max: number } {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return { min: 0, max: 1 };
  const low = Math.min(...finite);
  const high = Math.max(...finite);
  const room = (high - low || Math.abs(high) || 1) * pad;
  return { min: low - room, max: high + room };
}

const TICK_FONT = '11px "JetBrains Mono Variable", ui-monospace, monospace';

/** Horizontal grid lines with mono value labels on the left. */
/** A tidy step for about `count` intervals over a range: 1, 2, 2.5 or 5 times a power of ten. */
export function niceStep(range: number, count: number): number {
  const rough = range / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(rough || 1));
  const scaled = rough / power;
  const factor = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return factor * power;
}

/** Horizontal grid lines at round values, with mono labels on the left. */
export function grid(surface: Surface, frame: Frame, colours: Palette, lines = 4): void {
  const { context } = surface;
  const step = niceStep(frame.max - frame.min, lines);
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  context.save();
  context.font = TICK_FONT;
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  for (let value = Math.ceil(frame.min / step) * step; value <= frame.max + step * 1e-6; value += step) {
    const y = Math.round(yOf(frame, value)) + 0.5;
    context.strokeStyle = colours.grid;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(frame.left, y);
    context.lineTo(frame.right, y);
    context.stroke();
    context.fillStyle = colours.tick;
    context.fillText(value.toFixed(decimals), frame.left - 8, y);
  }
  context.restore();
}

export interface Incident {
  readonly start: number;
  /** Exclusive. */
  readonly end: number;
}

/**
 * A thin strip under the plot for every run of flagged readings, so a leak that lasts two hundred readings reads
 * as one incident, not two hundred rings.
 */
export function incidents(surface: Surface, frame: Frame, colours: Palette, runs: readonly Incident[]): void {
  const { context } = surface;
  context.save();
  context.fillStyle = colours.flag;
  for (const run of runs) {
    const from = xOf(frame, run.start);
    const to = xOf(frame, Math.max(run.start, run.end - 1));
    context.fillRect(from - 1.5, frame.bottom + 6, Math.max(3, to - from + 3), 3);
  }
  context.restore();
}

/** The detector's accepted band, as a soft fill with fine edges. Gaps where the band is unknown are left open. */
export function band(
  surface: Surface,
  frame: Frame,
  colours: Palette,
  lower: readonly (number | undefined)[],
  upper: readonly (number | undefined)[],
): void {
  const { context } = surface;
  const runs: number[][] = [];
  let current: number[] = [];
  lower.forEach((low, index) => {
    const high = upper[index];
    if (low === undefined || high === undefined || !Number.isFinite(low) || !Number.isFinite(high)) {
      if (current.length > 1) runs.push(current);
      current = [];
    } else current.push(index);
  });
  if (current.length > 1) runs.push(current);
  context.save();
  for (const run of runs) {
    context.beginPath();
    run.forEach((index, at) => {
      const x = xOf(frame, index);
      const y = yOf(frame, upper[index] as number);
      if (at === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    [...run].reverse().forEach(index => context.lineTo(xOf(frame, index), yOf(frame, lower[index] as number)));
    context.closePath();
    context.fillStyle = colours.band;
    context.fill();
    context.strokeStyle = colours.bandEdge;
    context.lineWidth = 1;
    context.stroke();
  }
  context.restore();
}

/** The readings as a single 1.5px line. */
export function line(surface: Surface, frame: Frame, colour: string, values: readonly number[], width = 1.5): void {
  const { context } = surface;
  context.save();
  context.strokeStyle = colour;
  context.lineWidth = width;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.beginPath();
  let drawing = false;
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      drawing = false;
      return;
    }
    const x = xOf(frame, index);
    const y = yOf(frame, value);
    if (drawing) context.lineTo(x, y);
    else context.moveTo(x, y);
    drawing = true;
  });
  context.stroke();
  context.restore();
}

/** Shades the stretches where the ground truth says something is wrong. */
export function truth(surface: Surface, frame: Frame, colours: Palette, labels: readonly boolean[]): void {
  const { context } = surface;
  context.save();
  context.fillStyle = colours.truth;
  const step = (frame.right - frame.left) / Math.max(1, frame.count - 1);
  labels.forEach((label, index) => {
    if (label) context.fillRect(xOf(frame, index) - step / 2, frame.top, Math.max(1, step), frame.bottom - frame.top);
  });
  context.restore();
}

/** The nazar rings: concentric circles around a flagged reading. `grow` animates the outer ring outwards. */
export function rings(surface: Surface, colours: Palette, x: number, y: number, grow = 1, alpha = 1): void {
  const { context } = surface;
  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = colours.flag;
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(x, y, 4.5, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = colours.flag;
  context.beginPath();
  context.arc(x, y, 2, 0, Math.PI * 2);
  context.fill();
  if (grow > 0) {
    context.globalAlpha = alpha * Math.max(0, 1 - grow);
    context.beginPath();
    context.arc(x, y, 4.5 + 16 * grow, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}
