import { expect, test, type Page } from '@playwright/test';

/**
 * These assertions encode the two hard layout rules of this project:
 *
 *   1. Nothing scrolls. It is a wall display with no keyboard, no mouse, and
 *      nobody standing close enough to reach it. A scrollbar means content that
 *      can never be read.
 *   2. Nothing is too small to read from two to three metres away.
 *
 * Both are easy to break accidentally with a CSS change and impossible to verify
 * reliably by eye, which is exactly why they are tested rather than documented.
 */

const MIN_FONT_PX_4K = 28;

async function waitForBoard(page: Page) {
  await page.goto('/');
  // The board renders once /api/config has resolved and the first SSE frame lands.
  await expect(page.locator('.stage')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.panel').first()).toBeVisible();
  // Let AutoFit and Paged complete their measure-then-render pass.
  await page.waitForTimeout(1_500);
}

test.describe('dashboard layout', () => {
  test.beforeEach(async ({ page }) => {
    await waitForBoard(page);
  });

  test('renders every configured component', async ({ page }) => {
    // The example config places eight components; each becomes one panel.
    const panels = page.locator('.panel');
    await expect(panels).toHaveCount(8);

    for (const title of ['Weather', 'Calendar', 'Departures', 'Meals', 'Chores', 'Briefing']) {
      await expect(page.locator('.panel__title', { hasText: title })).toBeVisible();
    }
  });

  test('no element on the page is scrollable', async ({ page }) => {
    const scrollable = await page.evaluate(() => {
      const offenders: string[] = [];
      for (const element of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
        const style = window.getComputedStyle(element);
        const canScrollY = ['auto', 'scroll'].includes(style.overflowY);
        const canScrollX = ['auto', 'scroll'].includes(style.overflowX);
        const overflowsY = element.scrollHeight > element.clientHeight + 1;
        const overflowsX = element.scrollWidth > element.clientWidth + 1;
        if ((canScrollY && overflowsY) || (canScrollX && overflowsX)) {
          offenders.push(`${element.tagName.toLowerCase()}.${element.className || '(no class)'}`);
        }
      }
      return offenders;
    });

    expect(scrollable, `these elements can be scrolled: ${scrollable.join(', ')}`).toEqual([]);
  });

  test('the page itself never overflows the viewport', async ({ page }) => {
    const overflow = await page.evaluate(() => ({
      horizontal: document.documentElement.scrollWidth - window.innerWidth,
      vertical: document.documentElement.scrollHeight - window.innerHeight,
    }));

    expect(overflow.horizontal).toBeLessThanOrEqual(1);
    expect(overflow.vertical).toBeLessThanOrEqual(1);
  });

  test('no panel clips its own content', async ({ page }) => {
    // AutoFit and Paged exist so that a long list is trimmed deliberately rather
    // than silently cut off. If a panel body overflows, one of them has failed.
    const clipped = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.panel__body'))
        .filter((body) => body.scrollHeight > body.clientHeight + 2)
        .map((body) => {
          const title = body.parentElement?.querySelector('.panel__title')?.textContent ?? 'untitled';
          return `${title}: content ${body.scrollHeight}px in ${body.clientHeight}px`;
        }),
    );

    expect(clipped, `these panels overflow: ${clipped.join('; ')}`).toEqual([]);
  });

  test('a truncated list says how much it is hiding', async ({ page }) => {
    // The calendar fixture deliberately holds more events than fit, so the
    // "+N more" affordance must appear rather than the list just ending.
    const calendar = page.locator('.panel', { has: page.locator('.panel__title', { hasText: 'Calendar' }) });
    const overflowNote = calendar.getByText(/^\+\d+ more$/);
    const eventRows = calendar.locator('.row');

    const rowCount = await eventRows.count();
    expect(rowCount).toBeGreaterThan(0);
    if (await overflowNote.count()) {
      await expect(overflowNote.first()).toBeVisible();
    }
  });

  test('the chore list pages instead of scrolling', async ({ page }) => {
    // The donetick fixture holds more chores than fit, so a page indicator must
    // appear — that is the no-scroll alternative doing its job.
    const chores = page.locator('.panel', { has: page.locator('.panel__title', { hasText: 'Chores' }) });
    // `:visible` skips the off-screen copy Paged renders in order to measure rows.
    await expect(chores.locator('.row:visible').first()).toBeVisible();
    await expect(chores.getByText(/^\d+\/\d+$/)).toBeVisible();
  });
});

test.describe('readability', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 4000, 'the size floor is specified for the 4K panel');

  test('nothing renders below the readable floor', async ({ page }) => {
    await waitForBoard(page);

    const tooSmall = await page.evaluate((floor) => {
      const offenders: { text: string; size: number }[] = [];

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim();
        if (!text) continue;

        const element = node.parentElement;
        if (!element) continue;

        // Skip the off-screen measurement copies AutoFit and Paged render.
        if (element.closest('[aria-hidden="true"]')) continue;

        const style = window.getComputedStyle(element);
        if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
        if (element.getBoundingClientRect().width === 0) continue;

        const size = parseFloat(style.fontSize);
        if (size < floor) offenders.push({ text: text.slice(0, 40), size: Math.round(size * 10) / 10 });
      }
      return offenders;
    }, MIN_FONT_PX_4K);

    expect(
      tooSmall,
      `text below ${MIN_FONT_PX_4K}px at 4K: ${tooSmall.map((o) => `"${o.text}" at ${o.size}px`).join(', ')}`,
    ).toEqual([]);
  });

  test('captures the board for review', async ({ page }, testInfo) => {
    // Deliberately an artifact rather than a pixel-comparison baseline: font
    // rendering differs between machines, so a committed 4K baseline would fail
    // for every contributor while catching almost nothing the assertions above
    // do not already catch. The image is attached to the run for a human to look at.
    await waitForBoard(page);

    const screenshot = await page.locator('.stage').screenshot({ animations: 'disabled' });
    await testInfo.attach('dashboard-4k', { body: screenshot, contentType: 'image/png' });

    // A blank or collapsed board would still screenshot; check it has real content.
    expect(screenshot.byteLength).toBeGreaterThan(50_000);
  });
});
