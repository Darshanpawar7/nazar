import { integer, isFiniteNumber, oneOf, option, readCount, record } from './check';
import type { Detector, Snapshot, Verdict } from './types';
import { SKIPPED } from './types';

// ---------------------------------------------------------------- ensemble

export type EnsembleMode = 'any' | 'all' | 'majority';

export interface EnsembleOptions {
  /**
   * - `any` (default): anomalous when any detector says so. Catches the most, raises the most false alarms.
   * - `all`: only when every detector agrees.
   * - `majority`: when more than half agree.
   */
  readonly mode?: EnsembleMode;
}

const MODES = ['any', 'all', 'majority'] as const;

function descending(values: number[]): number[] {
  return [...values].sort((a, b) => b - a);
}

function combine(verdicts: readonly Verdict[], mode: EnsembleMode): Verdict {
  const flagged = verdicts.filter(verdict => verdict.anomaly);
  const scores = descending(verdicts.map(verdict => verdict.score));
  const needed = mode === 'any' ? 1 : mode === 'all' ? verdicts.length : Math.floor(verdicts.length / 2) + 1;
  // The ensemble's score is the needed-th highest member score, so it crosses 1 exactly when the vote passes.
  const score = scores[needed - 1] ?? 0;
  const anomaly = flagged.length >= needed;
  const ready = mode === 'any' ? verdicts.some(verdict => verdict.ready) : verdicts.every(verdict => verdict.ready);
  const shaped = verdicts.find(verdict => verdict.expected !== undefined);
  const loudest = [...flagged].sort((a, b) => b.score - a.score)[0];
  const verdict: Verdict = {
    anomaly,
    score: anomaly ? score : Math.min(score, 1),
    ready,
    ...(shaped?.expected !== undefined ? { expected: shaped.expected } : {}),
    ...(shaped?.lower !== undefined ? { lower: shaped.lower, upper: shaped.upper } : {}),
  };
  return anomaly && loudest?.reason ? { ...verdict, reason: loudest.reason } : verdict;
}

/**
 * Runs several detectors on the same stream and combines their verdicts.
 *
 * A typical pairing is a spike detector with a shift detector: `hampel` for the burst, `cusum` for the slow
 * leak. The combined verdict borrows its expected value and band from the first detector that has one.
 *
 * @example
 * ```ts
 * import { cusum, ensemble, hampel } from 'nazar-js';
 *
 * const watch = ensemble([hampel(), cusum()], { mode: 'any' });
 * ```
 */
export function ensemble(detectors: readonly Detector[], options?: EnsembleOptions): Detector {
  if (!Array.isArray(detectors) || detectors.length === 0)
    throw new RangeError('ensemble: needs at least one detector');
  const mode = oneOf('ensemble', 'mode', option(options, 'mode', 'any'), MODES);
  return buildEnsemble([...detectors], mode, 0);
}

function buildEnsemble(members: Detector[], mode: EnsembleMode, initiallySkipped: number): Detector {
  let skipped = initiallySkipped;
  return {
    kind: 'ensemble',
    get skipped() {
      return skipped;
    },
    update(value: number, timestamp?: number): Verdict {
      if (!isFiniteNumber(value)) skipped += 1;
      return combine(
        members.map(member => member.update(value, timestamp)),
        mode,
      );
    },
    reset() {
      members.forEach(member => member.reset());
      skipped = 0;
    },
    snapshot(): Snapshot {
      return {
        kind: 'ensemble',
        version: 1,
        config: { mode },
        state: { skipped },
        children: members.map(member => member.snapshot()),
      };
    },
  };
}

// ---------------------------------------------------------------- persist

/** The same verdict, not (yet) anomalous: no reason, and a score held at the threshold. */
function quieten(verdict: Verdict): Verdict {
  return {
    anomaly: false,
    score: Math.min(verdict.score, 1),
    ready: verdict.ready,
    ...(verdict.expected !== undefined ? { expected: verdict.expected } : {}),
    ...(verdict.lower !== undefined ? { lower: verdict.lower, upper: verdict.upper } : {}),
  };
}

export interface PersistOptions {
  /** How many anomalous verdicts in a row it takes to raise the alarm. Default 3. */
  readonly min?: number;
}

/**
 * Raises the alarm only after `min` anomalous verdicts in a row.
 *
 * A single noisy reading should rarely wake someone up at 3 a.m.; three in a row probably should. Until the run
 * is long enough the score is capped at 1, so a persisted detector still reads "close to the line".
 *
 * @example
 * ```ts
 * import { persist, zscore } from 'nazar-js';
 *
 * const calm = persist(zscore(), { min: 3 });
 * ```
 */
export function persist(detector: Detector, options?: PersistOptions): Detector {
  const min = integer('persist', 'min', option(options, 'min', 3), 1, 1_000_000);
  return buildPersist(detector, min, 0);
}

function buildPersist(inner: Detector, min: number, initialRun: number): Detector {
  let run = initialRun;
  return {
    kind: 'persist',
    get skipped() {
      return inner.skipped;
    },
    update(value: number, timestamp?: number): Verdict {
      const verdict = inner.update(value, timestamp);
      if (verdict === SKIPPED) return verdict;
      run = verdict.anomaly ? run + 1 : 0;
      if (!verdict.anomaly || run >= min) return verdict;
      return quieten(verdict);
    },
    reset() {
      inner.reset();
      run = 0;
    },
    snapshot(): Snapshot {
      return { kind: 'persist', version: 1, config: { min }, state: { run }, children: [inner.snapshot()] };
    },
  };
}

// ---------------------------------------------------------------- revival, used by restore()

export function reviveEnsemble(config: unknown, state: unknown, children: Detector[]): Detector {
  const mode = oneOf('ensemble', 'mode', option(record('ensemble', config), 'mode', 'any'), MODES);
  if (children.length === 0) throw new RangeError('ensemble: needs at least one detector');
  return buildEnsemble(children, mode, readCount('ensemble', record('ensemble', state), 'skipped'));
}

export function revivePersist(config: unknown, state: unknown, children: Detector[]): Detector {
  const min = integer('persist', 'min', option(record('persist', config), 'min', 3), 1, 1_000_000);
  const [inner] = children;
  if (!inner || children.length !== 1) throw new RangeError('persist: needs exactly one detector');
  return buildPersist(inner, min, readCount('persist', record('persist', state), 'run'));
}
