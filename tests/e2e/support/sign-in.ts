import { expect, type Page } from "@playwright/test";

export async function sendCode(page: Page, phone: string) {
  await page.getByLabel("Phone number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
}

export async function verifyCode(page: Page, code = "000000") {
  await page.getByLabel("Verification code").fill(code);
  await page.getByRole("button", { name: "Verify code" }).click();
}

export async function chooseName(page: Page, name: string) {
  await expect(page.getByRole("heading", { name: "What's your name?" })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Sign Up" }).click();
}
