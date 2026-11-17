import { expect, type Page } from "@playwright/test";

import { eventPath, invitationPath, newAccount, returningAccount } from "./support/scenario.ts";
import { chooseName, sendCode, verifyCode } from "./support/sign-in.ts";
import { test } from "./support/test.ts";

const eventDestination = `${eventPath}?view=menu&from=sms&from=link`;
const invitationDestination = `${invitationPath}?from=sms%2Blink`;

test("returns a signed-in member to the requested event without asking for a name", async ({
  page,
}) => {
  await openProtectedLink(page, eventDestination);
  await sendCode(page, returningAccount.phone);
  await verifyCode(page);

  await expect(page).toHaveURL(eventDestination);
  await expect(
    page.getByRole("heading", { name: `Supper event for ${returningAccount.name}` }),
  ).toBeVisible();
});

test("denies event access after signup for an account without membership", async ({ page }) => {
  await openProtectedLink(page, eventDestination);
  await sendCode(page, newAccount.phone);
  await verifyCode(page);
  const [destination] = await Promise.all([
    waitForDestination(page, eventDestination),
    chooseName(page, newAccount.name),
  ]);

  await expect(page).toHaveURL(eventDestination);
  expect(destination.status()).toBe(403);
  await expect(
    page.getByRole("heading", { name: "You don't have access to this event." }),
  ).toBeVisible();
});

test("returns a newly verified guest to their invitation after signup", async ({ page }) => {
  await openProtectedLink(page, invitationDestination);
  await sendCode(page, newAccount.phone);
  await verifyCode(page);
  await chooseName(page, newAccount.name);

  await expect(page).toHaveURL(invitationDestination);
  await expect(
    page.getByRole("heading", { name: `Supper invitation for ${newAccount.name}` }),
  ).toBeVisible();
});

test("the destination rejects an invitation revoked while the guest signs up", async ({
  app,
  page,
}) => {
  await openProtectedLink(page, invitationDestination);
  await sendCode(page, newAccount.phone);
  await verifyCode(page);
  await expect(page.getByRole("heading", { name: "What's your name?" })).toBeVisible();
  await app.revokeInvitation();
  const [destination] = await Promise.all([
    waitForDestination(page, invitationDestination),
    chooseName(page, newAccount.name),
  ]);

  await expect(page).toHaveURL(invitationDestination);
  expect(destination.status()).toBe(403);
  await expect(page.getByRole("heading", { name: "This invitation has expired." })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: `Welcome, ${newAccount.name}` })).toBeVisible();
});

async function openProtectedLink(page: Page, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(
    (url) => url.pathname === "/sign-in" && url.searchParams.get("returnTo") === path,
  );
}

function waitForDestination(page: Page, path: string) {
  return page.waitForResponse((response) => response.url() === new URL(path, page.url()).href);
}
