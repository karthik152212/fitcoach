import { expect, test, type Page } from "@playwright/test";
import { seedApp } from "./fixtures/api";

/**
 * Responsive and keyboard contract, checked in a real browser.
 *
 * The shell switches from a bottom bar to a fixed side rail at 900px, so the
 * assertions use that single breakpoint rather than guessing per component.
 */

const WIDTHS = [320, 375, 430, 768, 1024, 1440];

async function overflow(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return { scroll: root.scrollWidth, client: root.clientWidth };
  });
}

test.describe("layout at every supported width", () => {
  for (const width of WIDTHS) {
    test(`${width}px keeps the dashboard and training in the viewport`, async ({ page }) => {
      await seedApp(page);
      await page.setViewportSize({ width, height: width < 500 ? 720 : 900 });

      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
      const home = await overflow(page);
      expect(home.scroll, `home overflows at ${width}px`).toBeLessThanOrEqual(home.client + 1);

      await page.goto("/train");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Upper A");
      const train = await overflow(page);
      expect(train.scroll, `training overflows at ${width}px`).toBeLessThanOrEqual(train.client + 1);
    });
  }
});

test("navigation is a bottom bar on mobile and a rail on desktop", async ({ page }) => {
  await seedApp(page);

  for (const width of [375, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav).toBeVisible({ timeout: 15_000 });
    const box = (await nav.boundingBox())!;
    expect(box.width, `bottom bar spans the width at ${width}px`).toBeGreaterThan(width * 0.9);
    expect(box.y + box.height, `bottom bar is anchored at ${width}px`).toBeGreaterThanOrEqual(798);

    // Touch targets stay at least 44px tall.
    const link = (await nav.getByRole("link").first().boundingBox())!;
    expect(link.height).toBeGreaterThanOrEqual(44);
  }

  for (const width of [1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav).toBeVisible({ timeout: 15_000 });
    const box = (await nav.boundingBox())!;
    expect(box.x, `rail sits on the left at ${width}px`).toBeLessThanOrEqual(2);
    expect(box.height, `rail is full height at ${width}px`).toBeGreaterThanOrEqual(898);
  }
});

test("the skip link is keyboard reachable and moves focus into the page", async ({ page }) => {
  await seedApp(page);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });

  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("a route change moves focus to the main region", async ({ page }) => {
  await seedApp(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("link", { name: "Progress" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Training record");
  await expect(page.locator("#main")).toBeFocused();
});
