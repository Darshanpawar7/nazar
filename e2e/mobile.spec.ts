import { canvasHasInk, expect, test } from './fixtures';

test('on a phone everything fits the screen and the charts still draw', async ({ page }) => {
  await page.goto('./');
  await expect.poll(() => canvasHasInk(page, '#hero-canvas')).toBe(true);
  await page.goto('./#playground');
  await expect.poll(() => canvasHasInk(page, '#play-canvas')).toBe(true);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
