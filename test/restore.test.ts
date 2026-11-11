import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  cusum,
  ensemble,
  flatline,
  hampel,
  pageHinkley,
  persist,
  range,
  rateOfChange,
  restore,
  seasonal,
  zscore,
  type Detector,
} from '../src';
import { signal, spike } from '../src/synth';

type Factory = () => Detector;

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const FACTORIES: ReadonlyArray<readonly [string, Factory]> = [
  ['zscore', () => zscore({ warmup: 5 })],
  ['hampel', () => hampel({ window: 7 })],
  ['cusum', () => cusum({ warmup: 5 })],
  ['pageHinkley', () => pageHinkley({ warmup: 5, lambda: 3 })],
  ['seasonal', () => seasonal({ period: 10, buckets: 5, warmup: 2 })],
  ['flatline', () => flatline({ samples: 3, tolerance: 0.5 })],
  ['range', () => range({ min: -5, max: 5 })],
  ['rateOfChange', () => rateOfChange({ maxDelta: 2, per: 'second' })],
  ['ensemble', () => ensemble([zscore({ warmup: 5 }), cusum({ warmup: 5 })], { mode: 'majority' })],
  ['persist', () => persist(ensemble([hampel({ window: 5 }), flatline({ samples: 2 })]), { min: 2 })],
];

const reading = fc.oneof(
  { weight: 20, arbitrary: fc.double({ min: -10, max: 10, noNaN: true }) },
  { weight: 1, arbitrary: fc.constantFrom(Number.NaN, Infinity) },
);

describe('snapshot and restore', () => {
  for (const [name, make] of FACTORIES) {
    it(`continues ${name} exactly where it left off, at any point in any stream`, () => {
      fc.assert(
        fc.property(fc.array(reading, { minLength: 1, maxLength: 80 }), fc.nat(), (values, cut) => {
          const at = cut % values.length;
          const original = make();
          const before = values.slice(0, at).map((value, index) => original.update(value, index * 1000));
          const revived = restore(JSON.parse(JSON.stringify(original.snapshot())));
          expect(revived.kind).toBe(original.kind);
          expect(revived.skipped).toBe(original.skipped);
          const rest = values.slice(at);
          const fromOriginal = rest.map((value, index) => original.update(value, (at + index) * 1000));
          const fromRevived = rest.map((value, index) => revived.update(value, (at + index) * 1000));
          // Compared as JSON: a snapshot is JSON, which has no negative zero, and -0 === 0 anyway.
          expect(plain(fromRevived)).toEqual(plain(fromOriginal));
          expect(before.length).toBe(at);
        }),
        { numRuns: 60 },
      );
    });
  }

  it('produces plain JSON that survives a round trip unchanged', () => {
    const detector = ensemble([hampel(), cusum()]);
    signal({ length: 200, seed: 2 }).values.forEach(value => detector.update(value));
    const text = JSON.stringify(detector.snapshot());
    expect(JSON.stringify(restore(JSON.parse(text)).snapshot())).toBe(text);
  });
});

describe('restore refuses hostile or broken snapshots', () => {
  const good = () => JSON.parse(JSON.stringify(zscore().snapshot())) as Record<string, unknown>;

  it.each([
    ['not an object', 'zscore'],
    ['null', null],
    ['an array', []],
    ['a missing kind', { version: 1, config: {}, state: {} }],
    ['an unknown kind', { kind: 'rm -rf', version: 1, config: {}, state: {} }],
    ['a prototype key as kind', { kind: '__proto__', version: 1, config: {}, state: {} }],
    ['constructor as kind', { kind: 'constructor', version: 1, config: {}, state: {} }],
    ['a future version', { ...good(), version: 2 }],
    ['config that is not an object', { ...good(), config: 'fast' }],
    ['state with a string number', { ...good(), state: { ...(good().state as object), mean: '1e3' } }],
    ['state with a negative count', { ...good(), state: { ...(good().state as object), count: -4 } }],
    ['an invalid config value', { ...good(), config: { ...(good().config as object), alpha: 7 } }],
  ])('refuses %s', (_, snapshot) => {
    expect(() => restore(snapshot)).toThrow(RangeError);
  });

  it('refuses a hampel window longer than its own setting', () => {
    const snapshot = JSON.parse(JSON.stringify(hampel({ window: 3 }).snapshot()));
    snapshot.state.window = [1, 2, 3, 4, 5];
    expect(() => restore(snapshot)).toThrow('hampel: state.window must be an array of at most 3');
  });

  it('refuses trees that are too deep or too wide', () => {
    let deep: unknown = zscore().snapshot();
    for (let level = 0; level < 20; level++)
      deep = { kind: 'persist', version: 1, config: { min: 1 }, state: { run: 0 }, children: [deep] };
    expect(() => restore(deep)).toThrow('nested more than 16 deep');
    const wide = {
      kind: 'ensemble',
      version: 1,
      config: { mode: 'any' },
      state: { skipped: 0 },
      children: Array(65).fill(zscore().snapshot()),
    };
    expect(() => restore(wide)).toThrow('at most 64 child snapshots');
    expect(() => restore({ kind: 'ensemble', version: 1, config: {}, state: { skipped: 0 }, children: [] })).toThrow(
      'at least one',
    );
    expect(() => restore({ kind: 'persist', version: 1, config: {}, state: { run: 0 }, children: [] })).toThrow(
      'exactly one',
    );
  });

  it('cannot pollute Object.prototype', () => {
    const hostile = JSON.parse(
      '{"kind":"zscore","version":1,"config":{"__proto__":{"polluted":true}},"state":{"count":0,"mean":0,"spread":0,"skipped":0}}',
    );
    restore(hostile);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe('combinators', () => {
  const always = (score: number): Detector => ({
    kind: 'fixed',
    skipped: 0,
    update: () => ({
      anomaly: score > 1,
      score,
      ready: true,
      expected: 1,
      lower: 0,
      upper: 2,
      ...(score > 1 ? { reason: 'spike' as const } : {}),
    }),
    reset: () => undefined,
    snapshot: () => ({ kind: 'fixed', version: 1, config: {}, state: {} }),
  });

  it('combines votes as any, all or majority', () => {
    const members = () => [always(3), always(0.2), always(1.5)];
    expect(ensemble(members(), { mode: 'any' }).update(0)).toMatchObject({ anomaly: true, score: 3, reason: 'spike' });
    expect(ensemble(members(), { mode: 'majority' }).update(0)).toMatchObject({ anomaly: true, score: 1.5 });
    expect(ensemble(members(), { mode: 'all' }).update(0)).toMatchObject({ anomaly: false, score: 0.2 });
    expect(ensemble(members()).update(0)).toMatchObject({ expected: 1, lower: 0, upper: 2 });
    expect(() => ensemble([])).toThrow('ensemble: needs at least one detector');
    expect(() => ensemble([always(1)], { mode: 'most' as never })).toThrow('mode must be one of');
  });

  it('raises the alarm only after enough anomalous verdicts in a row', () => {
    const calm = persist(rateOfChange({ maxDelta: 1 }), { min: 3 });
    const verdicts = [0, 5, 10, 15, 16, 30].map(value => calm.update(value));
    expect(verdicts.map(verdict => verdict.anomaly)).toEqual([false, false, false, true, false, false]);
    expect(verdicts[1]?.score).toBe(1);
    expect(verdicts[1]?.reason).toBeUndefined();
    expect(calm.update(Number.NaN)).toEqual({ anomaly: false, score: 0, ready: false });
    expect(calm.skipped).toBe(1);
    calm.reset();
    expect(calm.snapshot().state).toEqual({ run: 0 });
  });

  it('counts skipped readings and resets every member', () => {
    const both = ensemble([zscore(), hampel()]);
    both.update(Number.NaN);
    expect(both.skipped).toBe(1);
    both.reset();
    expect(both.skipped).toBe(0);
  });

  it('pairs a spike detector with a shift detector to catch both kinds of trouble', () => {
    let series = signal({ length: 1000, level: 0, noise: 1, seed: 12 });
    series = spike(series, 200, 8);
    const watch = ensemble([hampel(), cusum()]);
    const verdicts = series.values.map(value => watch.update(value));
    expect(verdicts[200]).toMatchObject({ anomaly: true, reason: 'spike' });
  });
});
