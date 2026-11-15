import { expect, test, type Page } from "@playwright/test";
import { publicViewportRoutes, viewportRoutes } from "../src/viewport/routes";

async function overflow(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });
}

const routes = [...publicViewportRoutes, ...viewportRoutes];

test("key pages do not overflow at 375px", async ({ page }) => {
  for (const route of routes) {
    const response = await page.goto(route.path);
    expect(response?.ok(), route.path).toBeTruthy();
    await expect(page.locator(`[data-surface="${route.surface}"]`), route.path).toBeVisible();
    const box = await overflow(page);
    expect(box.scrollWidth, `${route.path} scrollWidth ${box.scrollWidth} > clientWidth ${box.clientWidth}`).toBeLessThanOrEqual(
      box.clientWidth,
    );
  }
});

test("org drawer and command palette fit the viewport", async ({ page }) => {
  await page.goto("/viewport/org");
  await expect(page.locator('[data-surface="org"]')).toBeVisible();
  await expect(page.getByRole("link", { name: "Overview" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
  const drawer = await overflow(page);
  expect(drawer.scrollWidth).toBeLessThanOrEqual(drawer.clientWidth);
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Jump to a page" })).toBeVisible();
  const dialog = await overflow(page);
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
});
