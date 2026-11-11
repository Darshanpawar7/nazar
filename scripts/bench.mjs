// Updates per second for each detector, measured on the built package.
//   npm run build && npm run bench
import { cpus } from 'node:os';
import { cusum, ensemble, flatline, hampel, pageHinkley, persist, range, rateOfChange, seasonal, zscore } from '../dist/index.js';
import { waterFlowWithLeak } from '../dist/synth.js';

const READINGS = 2_000_000;
const ROUNDS = 5;
const data = waterFlowWithLeak();
const values = data.values;
const times = data.timestamps;

const CASES = [
  ['zscore()', () => zscore()],
  ['hampel({ window: 51 })', () => hampel()],
  ['cusum()', () => cusum()],
  ['pageHinkley()', () => pageHinkley()],
  ['seasonal()', () => seasonal()],
  ['flatline()', () => flatline()],
  ['range({ min, max })', () => range({ min: 0, max: 40 })],
  ['rateOfChange()', () => rateOfChange({ maxDelta: 5 })],
  ['ensemble([hampel(), cusum()])', () => ensemble([hampel(), cusum()])],
  ['persist(cusum(), { min: 3 })', () => persist(cusum(), { min: 3 })],
];

function measure(make) {
  let best = 0;
  let sink = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const detector = make();
    const started = process.hrtime.bigint();
    for (let index = 0; index < READINGS; index++) {
      const at = index % values.length;
      if (detector.update(values[at], times[at]).anomaly) sink += 1;
    }
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    best = Math.max(best, READINGS / seconds);
  }
  return { best, sink };
}

console.log(`Node ${process.version} on ${cpus()[0]?.model ?? 'unknown CPU'}`);
console.log(`${READINGS.toLocaleString('en')} readings per round, best of ${ROUNDS} rounds\n`);
console.log('| Detector | Updates per second |');
console.log('| --- | ---: |');
for (const [name, make] of CASES) {
  const { best } = measure(make);
  console.log(`| \`${name}\` | ${(best / 1e6).toFixed(1)} million |`);
}
