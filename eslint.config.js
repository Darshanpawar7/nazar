import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'site-dist', 'coverage', 'playwright-report', 'test-results', 'site/public/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { 'no-console': 'error', eqeqeq: 'error' },
  },
  {
    // Command-line scripts and examples report what they did.
    files: ['scripts/**', 'examples/**', 'e2e/**'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
