import { canvasHasInk, expect, expectAccessible, test } from './fixtures';

test('the hero stream draws, flags incidents and logs them', async ({ page }) => {
  await page.goto('./');
  await expect.poll(() => canvasHasInk(page, '#hero-canvas')).toBe(true);
  await expect(page.locator('#hero-log li').first()).toContainText(/detected/);
  await expect(page.locator('#hero-status')).toHaveText('live');
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.locator('#hero-status')).toHaveText('paused');
});

test('every detector card draws its example', async ({ page }) => {
  await page.goto('./#detectors');
  await expect(page.locator('.card')).toHaveCount(6);
  for (let index = 1; index <= 6; index++) {
    await expect.poll(() => canvasHasInk(page, `.card:nth-child(${index}) canvas`)).toBe(true);
  }
});

test('the playground responds to every control and prints matching code', async ({ page }) => {
  await page.goto('./#playground');
  const caught = page.locator('#metrics div').first().locator('dd');
  await expect(caught).toHaveText('3 of 3');

  await page.getByLabel('Detector', { exact: true }).selectOption('zscore');
  await expect(page.locator('#params input')).toHaveCount(2);
  await page.getByRole('tab', { name: 'Code' }).click();
  await expect(page.locator('#play-code')).toContainText('zscore({ threshold: 3, alpha: 0.05 })');

  await page.getByLabel('Threshold', { exact: true }).fill('5');
  await expect(page.locator('#play-code')).toContainText('threshold: 5');
  await page.getByLabel('Alarm after', { exact: true }).fill('3');
  await expect(page.locator('#play-code')).toContainText('persist(zscore(');
  await expect(page).toHaveURL(/#play\?s=water-flow-leak&d=zscore/);

  await page.getByLabel('Scenario', { exact: true }).selectOption('tank-stuck');
  await expect(page.getByLabel('Detector', { exact: true })).toHaveValue('flatline');
  await expect(caught).toHaveText('1 of 1');
});

test('a shared link restores the configuration, and nonsense in the link is ignored', async ({ page }) => {
  await page.goto('./#play?s=cold-room&d=cusum&k=1.2&h=8&n=2');
  await expect(page.getByLabel('Scenario', { exact: true })).toHaveValue('cold-room');
  await expect(page.getByLabel('Detector', { exact: true })).toHaveValue('cusum');
  await page.getByRole('tab', { name: 'Code' }).click();
  await expect(page.locator('#play-code')).toContainText('persist(cusum({ k: 1.2, h: 8 }), { min: 2 })');

  await page.goto('./#play?s=..%2F..%2Fetc&d=%3Cscript%3E&k=1e99');
  await page.reload();
  await expect(page.getByLabel('Scenario', { exact: true })).toHaveValue('water-flow-leak');
});

test('clicking the chart adds a spike that the detector is scored on', async ({ page }) => {
  await page.goto('./#play?s=water-flow-leak&d=hampel&window=51&threshold=3&n=1');
  const events = page.locator('#metrics div').first().locator('dd');
  const before = (await events.textContent()) ?? '';
  await page.locator('#play-canvas').click({ position: { x: 300, y: 100 } });
  await expect(events).not.toHaveText(before);
  await page.getByRole('button', { name: 'Remove my spikes' }).click();
  await expect(events).toHaveText(before);
});

test('the theme switch works and is remembered', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Switch to the light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

for (const theme of ['dark', 'light'] as const) {
  test(`the page has no serious accessibility problems in the ${theme} theme`, async ({ page }) => {
    await page.goto('./');
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to the light theme' }).click();
    await expectAccessible(page);
    await page.getByRole('tab', { name: 'Code' }).click();
    await expectAccessible(page);
  });
}
