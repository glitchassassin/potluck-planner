import { expect } from "@playwright/test";
import { test } from "./support/test.ts";

test("the kitchen sink is unavailable in production", async ({ request }) => {
  const response = await request.get("/dev/kitchen-sink");

  expect(response.status()).toBe(404);
});
