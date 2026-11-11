import { defineConfig, type Plugin } from 'vite';

// The playground site. It imports the library straight from ../src, so it always shows the code in this repo.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'nazar-csp',
    apply: 'build',
    transformIndexHtml: html =>
      html.replace('<!--csp-->', `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

export default defineConfig(({ command, isPreview }) => ({
  root: 'site',
  // GitHub Pages serves the site from /nazar/. Override with BASE_PATH for any other host.
  base: process.env.BASE_PATH ?? (command === 'build' || isPreview ? '/nazar/' : '/'),
  plugins: [contentSecurityPolicy()],
  build: { outDir: '../site-dist', emptyOutDir: true, target: 'es2022', assetsInlineLimit: 0 },
}));
