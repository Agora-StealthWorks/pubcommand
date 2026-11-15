import { expect, test, type Locator, type Page } from "@playwright/test";
import { publicViewportRoutes, viewportRoutes } from "../src/viewport/routes";

const LONG_EMAIL = "stephen.operator.with.a.very.long.mailbox@onenationfinancial.example";

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

async function expectTapTarget(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error("Missing tap target box");
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
}

test("organization admin fits a phone", async ({ page }) => {
  await page.goto("/viewport/admin/orgs/empty");
  await expect(page.getByRole("columnheader", { name: "Name" })).toBeVisible();
  await expect(page.getByText("No organizations yet")).toBeVisible();
  await expectTapTarget(page.getByRole("link", { name: "Create" }));
  await expectTapTarget(page.getByRole("link", { name: "New organization" }));
  const empty = await overflow(page);
  expect(empty.scrollWidth).toBeLessThanOrEqual(empty.clientWidth);

  await page.goto("/viewport/admin/orgs");
  await expect(page.getByRole("columnheader", { name: "Name" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Plan" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Seats" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Northstar Publishing Desk" })).toBeVisible();
  await expect(page.getByRole("link", { name: "https://northstar-publishing-command-desk.pubcommand.com" }).first()).toBeVisible();
  await expectTapTarget(page.getByRole("link", { name: "New organization" }));
  await expectTapTarget(page.getByRole("link", { name: "Open org" }));
  await page.getByRole("link", { name: "New organization" }).click();
  await expect(page.locator('[data-surface="admin-orgs-new"]')).toBeVisible();

  await expect(page.getByLabel("Organization name")).toBeVisible();
  await expect(page.getByLabel("Subdomain")).toBeVisible();
  await expect(page.getByLabel("Plan")).toBeVisible();
  await expect(page.getByLabel("First admin email")).toBeVisible();
  await expectTapTarget(page.getByRole("button", { name: "Create organization" }));
  for (const word of ["admin", "app", "www", "api"]) {
    await page.getByLabel("Subdomain").fill(word.toUpperCase());
    await expect(page.getByLabel("Subdomain")).toHaveValue(word);
    await expect(page.getByText("That name is reserved.")).toBeVisible();
  }
  const form = await overflow(page);
  expect(form.scrollWidth).toBeLessThanOrEqual(form.clientWidth);

  await page.goto("/viewport/admin/orgs/detail");
  await expect(page.getByRole("heading", { name: "Northstar Publishing Desk" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
  await expect(page.getByText(LONG_EMAIL, { exact: true })).toBeVisible();
  await expect(page.getByText("https://northstar-publishing-command-desk.pubcommand.com").first()).toBeVisible();
  await expectTapTarget(page.getByRole("link", { name: "Open org" }));
  await expectTapTarget(page.getByRole("button", { name: "Add me as admin" }));
  await expectTapTarget(page.getByRole("button", { name: "Add member" }));
  await expectTapTarget(page.getByRole("button", { name: "Remove" }));
  await expectTapTarget(page.getByRole("button", { name: "Change plan" }));
  await expectTapTarget(page.getByRole("button", { name: "Suspend" }));
  const detail = await overflow(page);
  expect(detail.scrollWidth).toBeLessThanOrEqual(detail.clientWidth);
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
