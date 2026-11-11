import type { Adaptation, Reason, Verdict } from '../types';
import { capScore, MAX_SCORE } from '../types';

/** Whether a reading with this outcome should move the baseline. */
export function learns(adapt: Adaptation, anomaly: boolean): boolean {
  return adapt === 'always' || (adapt === 'normal-only' && !anomaly);
}

/** distance / allowance, where an allowance of zero means only an exact match is normal. */
export function ratio(distance: number, allowance: number): number {
  if (allowance > 0) return capScore(distance / allowance);
  return distance === 0 ? 0 : MAX_SCORE;
}

export function warming(expected?: number): Verdict {
  return expected === undefined || Number.isNaN(expected)
    ? { anomaly: false, score: 0, ready: false }
    : { anomaly: false, score: 0, ready: false, expected };
}

/** A ready verdict around an expected value with a symmetric band. Anomalous when the score is above 1. */
export function banded(score: number, expected: number, halfWidth: number, reason: Reason): Verdict {
  const anomaly = score > 1;
  const base = { anomaly, score, ready: true, expected, lower: expected - halfWidth, upper: expected + halfWidth };
  return anomaly ? { ...base, reason } : base;
}
