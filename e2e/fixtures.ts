import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Page } from '@playwright/test';

/** Fails a test on any console error or uncaught exception. */
export const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
      page.on('console', message => {
        if (message.type() === 'error') problems.push(`console: ${message.text()}`);
      });
      await use(problems);
      expect(problems, 'the page logged errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter(
    violation => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(
    serious.map(violation => `${violation.id}: ${violation.nodes.map(node => node.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

/** True when a canvas has drawn something other than one flat colour. */
export async function canvasHasInk(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).evaluate(canvas => {
    const element = canvas as HTMLCanvasElement;
    const context = element.getContext('2d');
    if (!context || element.width === 0) return false;
    const { data } = context.getImageData(0, 0, element.width, element.height);
    const first = data.slice(0, 4).join(',');
    for (let index = 0; index < data.length; index += 4 * 97) {
      if (data.slice(index, index + 4).join(',') !== first) return true;
    }
    return false;
  });
}
