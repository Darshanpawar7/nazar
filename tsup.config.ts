import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', synth: 'src/synth.ts', eval: 'src/eval.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: false,
  target: 'es2020',
  treeshake: true,
  outDir: 'dist',
});
