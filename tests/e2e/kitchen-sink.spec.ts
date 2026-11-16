import { expect, test } from "@playwright/test";

test("the kitchen sink is unavailable in production", async ({ request }) => {
  const response = await request.get("/dev/kitchen-sink");

  expect(response.status()).toBe(404);
});
