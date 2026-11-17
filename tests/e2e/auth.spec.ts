import { mkdtempDisposable } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "@playwright/test";

import { newAccount } from "./support/scenario.ts";
import { chooseName, sendCode, verifyCode } from "./support/sign-in.ts";
import { test } from "./support/test.ts";

test("signs up without an invitation, stays signed in after restarting the browser, and logs out", async ({
  playwright,
  baseURL,
}) => {
  await using profile = await mkdtempDisposable(join(tmpdir(), "potluck-browser-"));
  const { name, phone } = newAccount;
  const first = await playwright.chromium.launchPersistentContext(profile.path, { baseURL });
  try {
    const [page] = first.pages();
    await page.goto("/");
    await expect(page).toHaveURL("/sign-in");
    await sendCode(page, phone);
    await expect(page.getByText("We sent a code to (212) 555-0142.")).toBeVisible();
    await verifyCode(page);
    await chooseName(page, name);
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: `Welcome, ${name}` })).toBeVisible();
  } finally {
    await first.close();
  }

  // Closing a persistent context stops Chromium. The second launch reads the same disk profile.
  const restarted = await playwright.chromium.launchPersistentContext(profile.path, { baseURL });
  try {
    const [page] = restarted.pages();
    await page.goto("/");
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: `Welcome, ${name}` })).toBeVisible();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL("/sign-in");
    await page.goto("/");
    await expect(page).toHaveURL("/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in or sign up" })).toBeVisible();
  } finally {
    await restarted.close();
  }
});

test("rejects an unsupported phone number on the sign-in form", async ({ page }) => {
  await page.goto("/sign-in");
  const phone = page.getByLabel("Phone number");
  await phone.fill("+1 416-555-0142");
  await page.getByRole("button", { name: "Send code" }).click();

  await expect(page).toHaveURL("/sign-in");
  await expect(page.getByRole("alert")).toHaveText("Enter a supported phone number.");
  await expect(phone).toHaveAccessibleDescription("Enter a supported phone number.");
});

test("explains resend cooldown and incorrect-code lockout, then allows recovery", async ({
  app,
  page,
}) => {
  await page.goto("/sign-in");
  await sendCode(page, newAccount.phone);
  const resend = page.getByRole("button", { name: "Resend code" });
  const feedback = page.getByRole("alert");

  await resend.click();
  await expect(feedback).toHaveText("Wait before requesting another code. Try again in 1 minute.");
  await app.advanceTime(60_000);
  await resend.click();
  await expect(page.getByText("We sent another code to (212) 555-0142.")).toBeVisible();

  for (let attempt = 1; attempt <= 4; attempt++) {
    await verifyCode(page, "111111");
    await expect(feedback).toHaveText("That code is incorrect. Check the SMS and try again.");
  }
  await verifyCode(page, "111111");
  const locked =
    "Too many incorrect codes. Wait before requesting a new code. Try again in 9 minutes.";
  await expect(feedback).toHaveText(locked);
  await verifyCode(page);
  await expect(feedback).toHaveText(locked);
  await resend.click();
  await expect(feedback).toHaveText(locked);

  await app.advanceTime(9 * 60_000);
  await resend.click();
  await expect(page.getByText("We sent another code to (212) 555-0142.")).toBeVisible();
  await verifyCode(page);
  await expect(page.getByRole("heading", { name: "What's your name?" })).toBeVisible();
});
