import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("home page loads without browser errors and passes accessibility checks", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveTitle("Potluck Planner");
  await expect(page.getByRole("heading", { name: "Hello world", level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
});
