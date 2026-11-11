// Captures the README screenshots and the banner from a running production build of the site.
//
//   npm run site:build && npm run site:preview     (in one terminal)
//   npm run screenshots                            (in another)
//
// Options: NAZAR_URL (default http://localhost:4202/nazar/), SHOTS_DIR (default docs/screenshots).
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const URL = process.env.NAZAR_URL ?? 'http://localhost:4202/nazar/';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots';
const problems = [];

async function open(browser, { width, height, scale = 1, light = false }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  if (light) await context.addInitScript(() => localStorage.setItem('nazar-theme', 'light'));
  const page = await context.newPage();
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  return { context, page };
}

async function at(page, hash, settle = 600) {
  await page.goto(`${URL}${hash}`, { waitUntil: 'networkidle' });
  if (hash) await page.locator(hash.split('?')[0].replace('#play', '#playground')).scrollIntoViewIfNeeded();
  await page.waitForTimeout(settle);
}

async function shot(page, name, options = {}) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, ...options });
  console.log('wrote', file);
}

const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
await mkdir(OUT, { recursive: true });

{
  const { context, page } = await open(browser, { width: 1440, height: 900 });
  await at(page, '', 4500); // let the stream run into an incident
  await shot(page, 'hero');
  await page.locator('.monitor').screenshot({ path: path.join(OUT, 'monitor.png') });
  console.log('wrote', path.join(OUT, 'monitor.png'));
  await at(page, '#detectors');
  await shot(page, 'detectors');
  await at(page, '#play?s=water-flow-leak&d=cusum&k=0.5&h=5&n=1');
  await shot(page, 'playground');
  await page.getByRole('tab', { name: 'Code' }).click();
  await page.waitForTimeout(300);
  await page.locator('.play').screenshot({ path: path.join(OUT, 'playground-code.png') });
  console.log('wrote', path.join(OUT, 'playground-code.png'));
  await context.close();
}

{
  const { context, page } = await open(browser, { width: 1440, height: 900, light: true });
  await at(page, '#play?s=power-daily&d=seasonal&threshold=3&buckets=24&n=1');
  await shot(page, 'playground-light');
  await context.close();
}

{
  const { context, page } = await open(browser, { width: 390, height: 844, scale: 2 });
  await at(page, '', 3500);
  await page.locator('.monitor').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, 'mobile-hero');
  await at(page, '#play?s=tank-stuck&d=flatline&samples=10&tolerance=0&n=1');
  await shot(page, 'mobile-playground');
  await context.close();
}

{
  const context = await browser.newContext({ viewport: { width: 1280, height: 640 } });
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve('docs/brand/banner.html')).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'docs/banner.png' });
  console.log('wrote docs/banner.png');
  await context.close();
}

await browser.close();
if (problems.length > 0) {
  console.error(`\n${problems.length} console problem(s):\n${[...new Set(problems)].join('\n')}`);
  process.exitCode = 1;
}
