// A serverless function sees one reading per invocation and remembers nothing between them.
// Here each "invocation" restores the detector from a stored snapshot, updates it, and saves it again.
//   npm run build && node examples/cold-start.mjs
import { cusum, restore } from '../dist/index.js';
import { waterFlowWithLeak } from '../dist/synth.js';

const store = new Map(); // stands in for Redis, KV, DynamoDB...

function handleReading(reading) {
  const saved = store.get('flow-sensor-7');
  const detector = saved ? restore(JSON.parse(saved)) : cusum();
  const verdict = detector.update(reading);
  store.set('flow-sensor-7', JSON.stringify(detector.snapshot()));
  return verdict;
}

const { values } = waterFlowWithLeak();
let alarms = 0;
let previous = false;
values.forEach(reading => {
  const { anomaly } = handleReading(reading);
  if (anomaly && !previous) alarms += 1; // one incident per run of flagged readings
  previous = anomaly;
});
console.log(`${values.length} invocations, each starting cold. Incidents raised: ${alarms}.`);
console.log(`Snapshot size: ${store.get('flow-sensor-7').length} bytes.`);
