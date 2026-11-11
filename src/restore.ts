import { record } from './check';
import { reviveEnsemble, revivePersist } from './combinators';
import { cusumCodec } from './detectors/cusum';
import { hampelCodec } from './detectors/hampel';
import { pageHinkleyCodec } from './detectors/page-hinkley';
import { seasonalCodec } from './detectors/seasonal';
import { flatlineCodec, rangeCodec, rateOfChangeCodec } from './detectors/simple';
import { zscoreCodec } from './detectors/zscore';
import type { Detector, Snapshot } from './types';

type Revive = (config: unknown, state: unknown) => Detector;

/** A map with no prototype, so a kind such as "__proto__" or "constructor" can never resolve to anything. */
const DETECTORS: ReadonlyMap<string, Revive> = new Map(
  [
    zscoreCodec,
    hampelCodec,
    cusumCodec,
    pageHinkleyCodec,
    seasonalCodec,
    flatlineCodec,
    rangeCodec,
    rateOfChangeCodec,
  ].map(codec => [codec.kind, codec.revive] as const),
);

const COMBINATORS: ReadonlyMap<string, (config: unknown, state: unknown, children: Detector[]) => Detector> = new Map([
  ['ensemble', reviveEnsemble],
  ['persist', revivePersist],
]);

/** Deeper trees than this are refused, so a hostile snapshot cannot exhaust the stack. */
const MAX_DEPTH = 16;
/** Wider combinators than this are refused, so a hostile snapshot cannot exhaust memory. */
const MAX_CHILDREN = 64;

function revive(value: unknown, depth: number): Detector {
  if (depth > MAX_DEPTH) throw new RangeError(`restore: detectors are nested more than ${MAX_DEPTH} deep`);
  const snapshot = record('restore', value);
  const kind = Object.prototype.hasOwnProperty.call(snapshot, 'kind') ? snapshot.kind : undefined;
  if (typeof kind !== 'string') throw new RangeError('restore: snapshot.kind must be a string');
  if (snapshot.version !== 1) throw new RangeError(`restore: unsupported snapshot version ${String(snapshot.version)}`);

  const detector = DETECTORS.get(kind);
  if (detector) return detector(snapshot.config, snapshot.state);

  const combinator = COMBINATORS.get(kind);
  if (!combinator) throw new RangeError(`restore: unknown detector kind "${kind}"`);
  const children = snapshot.children;
  if (!Array.isArray(children) || children.length > MAX_CHILDREN) {
    throw new RangeError(`restore: ${kind} needs a list of at most ${MAX_CHILDREN} child snapshots`);
  }
  return combinator(
    snapshot.config,
    snapshot.state,
    children.map(child => revive(child, depth + 1)),
  );
}

/**
 * Rebuilds a detector, or a whole tree of combined detectors, from a snapshot.
 *
 * The snapshot is treated as untrusted input: every field is checked, unknown kinds and malformed state are
 * refused with a RangeError, and nothing in it is ever executed. Restoring and then continuing produces exactly
 * the verdicts the original detector would have produced.
 *
 * @example
 * ```ts
 * import { cusum, restore } from 'nazar-js';
 *
 * // In a serverless function: pick up where the last invocation left off.
 * const detector = saved ? restore(JSON.parse(saved)) : cusum();
 * const verdict = detector.update(reading);
 * await store.put(JSON.stringify(detector.snapshot()));
 * ```
 */
export function restore(snapshot: Snapshot | unknown): Detector {
  return revive(snapshot, 0);
}
