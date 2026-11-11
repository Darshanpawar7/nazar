// Picks a cusum threshold by scoring a few candidates on labelled data.
//   npm run build && node examples/tune.mjs
import { cusum } from '../dist/index.js';
import { evaluate } from '../dist/eval.js';
import { waterFlowWithLeak } from '../dist/synth.js';

const data = waterFlowWithLeak();
console.log('| h | caught | false alarms | F1 | delay |');
console.log('| ---: | ---: | ---: | ---: | ---: |');
for (const h of [2, 3, 4, 5, 6, 8, 10]) {
  const detector = cusum({ h });
  const flags = data.values.map(value => detector.update(value).anomaly);
  const score = evaluate(flags, data.labels, { tolerance: 10 });
  console.log(
    `| ${h} | ${score.detected}/${score.events} | ${score.falseAlarms} | ${score.f1.toFixed(2)} | ${score.meanDelay.toFixed(1)} |`,
  );
}
