import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("the public sign-in page passes accessibility checks", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveTitle("Potluck Planner");
  await expect(page).toHaveURL("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in or sign up", level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("signup works in the production build with the Verify mock", async ({ page }, testInfo) => {
  const number = `555-${String(100 + (testInfo.workerIndex % 100)).padStart(4, "0")}`;
  await page.goto("/sign-in");
  await page.getByLabel("Phone number").fill(`+1 212-${number}`);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText(`We sent a code to (212) ${number}.`)).toBeVisible();
  await page.getByLabel("Verification code").fill("000000");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("heading", { name: "What's your name?" })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Alex");
  await page.getByRole("button", { name: "Sign Up" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Alex" })).toBeVisible();
});
