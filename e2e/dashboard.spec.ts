import { expect, test } from "@playwright/test";
import { dashboardFixture } from "./fixtures/dashboard";

test("renders the editorial panorama on desktop and mobile", async ({ page }, testInfo) => {
  expect(testInfo.project.name).toBe("system-chrome");
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });

  let serveFailure = true;
  await page.route("**/api/dashboard", async (route) => {
    if (serveFailure) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{",
      });
      return;
    }
    await route.fulfill({ status: 200, json: dashboardFixture });
  });

  await page.goto("/ledashboard/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Le panorama ne répond pas" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();

  serveFailure = false;
  await page.getByRole("button", { name: "Réessayer" }).click();
  await expect(page.getByRole("heading", { name: "La maison, en un regard" })).toBeVisible();
  await expect(page.locator("article")).toHaveCount(7);
  await expect(page.getByText("Confort", { exact: true })).toBeVisible();
  await expect(page.getByText("Disponibilité", { exact: true })).toBeVisible();
  await expect(page.getByText("NAS · données anciennes", { exact: true })).toBeVisible();
  await expect(page.getByText("Incident en cours · couchdb", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/Raspberry|PC|iPhone|média|vidéo/i);
  expect(await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.waitForTimeout(2_000);
  await expect(page).toHaveScreenshot("dashboard-desktop.png", {
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("article")).toHaveCount(7);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.waitForTimeout(2_000);
  await expect(page).toHaveScreenshot("dashboard-mobile.png", {
    fullPage: true,
  });

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
