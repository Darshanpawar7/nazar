# Architecture

## The contract

Everything in the library is a `Detector`:

```ts
interface Detector {
  readonly kind: string;
  update(value: number, timestamp?: number): Verdict;
  reset(): void;
  snapshot(): Snapshot;
  readonly skipped: number;
}
```

A `Verdict` always carries `anomaly`, `score` and `ready`, and optionally `expected`, `lower`, `upper` and `reason`.
The score is normalised so that 0 is normal, 1 is exactly at the threshold and anything above 1 is anomalous, whatever
the detector's own statistic is. That one rule lets combinators vote across detectors without knowing their types.

## Module map

| Module                | Responsibility                                                                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`            | The contract above, the `SKIPPED` verdict and the score cap.                                                                                                                                                           |
| `check.ts`            | Validation. Settings throw a `RangeError` that names the detector and the setting. Saved state is read through helpers that accept only own properties and finite numbers.                                             |
| `stats.ts`            | The streaming statistics: Welford, exponentially weighted mean and variance, a fixed window, a rolling median with a linear-time MAD, mulberry32 and a Gaussian sampler. These mutate only their own internal buffers. |
| `detectors/shared.ts` | The pieces every detector shares: whether to learn from a reading, the score ratio, the warming and banded verdicts.                                                                                                   |
| `detectors/*.ts`      | One file per detector (the three simplest share `simple.ts`). Each exports a factory and a codec, `{ kind, revive(config, state) }`, used by `restore`.                                                                |
| `combinators.ts`      | `ensemble` and `persist`, and their revive functions.                                                                                                                                                                  |
| `restore.ts`          | Rebuilds a detector tree from a snapshot through a registry built on first use, with depth and width limits.                                                                                                           |
| `synth.ts`            | Seeded signals and injectors that return new arrays, plus four labelled scenarios. Subpath `nazar-js/synth`.                                                                                                           |
| `eval.ts`             | Event-based scoring. Subpath `nazar-js/eval`.                                                                                                                                                                          |

## Anatomy of a detector

Each detector follows the same pattern:

1. `configure(options)` fills in defaults and validates every setting, so a bad setting fails at construction.
2. `build(config, saved?)` creates the closure. If a snapshot's state is passed, it is read field by field through
   `check.ts`. Anything malformed throws.
3. `update` first skips non-finite readings and counts them. During warm-up it learns and returns a not-ready
   verdict. After warm-up it computes the expectation and the band before learning, scores the reading, and then
   learns from it only if the adaptation policy allows.
4. `snapshot` returns `{ kind, version: 1, config, state }`, plain data only.

Detectors are closures rather than classes, so the public surface is exactly the interface.

## Adaptation

`adapt` decides whether a reading moves the baseline:

| Policy                  | Learns from normal readings | Learns from flagged readings |
| ----------------------- | --------------------------- | ---------------------------- |
| `normal-only` (default) | yes                         | no                           |
| `always`                | yes                         | yes                          |
| `never`                 | only during warm-up         | no                           |

`normal-only` is the default because the failure it prevents, learning a leak as the new normal, is silent and
expensive. The cusum tests show both behaviours on the same data.

## Restore and safety

A snapshot may come from a database, a file or a network, so `restore` treats it as untrusted:

- the kind is looked up in a `Map`, so `__proto__` or `constructor` can never resolve to anything;
- the version must be 1;
- configuration goes through the same validation as the factory;
- state fields are read as own properties and must be finite numbers or arrays of them, with length limits;
- trees deeper than 16 or combinators wider than 64 are refused;
- nothing in a snapshot is ever called or evaluated.

## The site

`site/` is plain TypeScript and canvas, built by Vite and importing the library straight from `src/`. `chart.ts` draws
crisp lines at any pixel density and reads its colours from CSS custom properties, so the two themes need no chart
code. The hero runs one `requestAnimationFrame` loop that pauses when the canvas is off-screen or the tab is hidden,
and does not start under reduced motion. The playground reruns the chosen detector over the whole scenario on every
control change (600 readings take well under a millisecond). It measures throughput after a short debounce, and keeps
its state in the address bar, validated on the way in.

## Extending

- **A new detector:** add `src/detectors/<name>.ts` with `configure`, `build`, the factory and a codec; register the
  codec in `restore.ts`; export it from `index.ts`; add it to the restore property test's list. Write its behaviour
  tests against a labelled synthetic series first.
- **A new combinator:** export a revive function and add it to the combinator registry in `restore.ts`.
- **A new scenario:** add a function to `synth.ts` and to `SCENARIOS`; the playground picks it up.
