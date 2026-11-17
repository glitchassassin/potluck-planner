import assert from "node:assert/strict";
import { it } from "remix/test";

import { createTwilioVerifyClient } from "./twilio-verify.ts";

const env = {
  TWILIO_VERIFY_SERVICE_SID: "VA" + "1".repeat(32),
  TWILIO_API_KEY_SID: "SK" + "2".repeat(32),
  TWILIO_API_KEY_SECRET: "fake-secret",
};
const baseUrl = `https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}`;
const phone = "+12125550142";
const sid = "VE" + "3".repeat(32);
const code = "012345";

it("sends SMS through Verify and checks the exact SID with a form-encoded code", async () => {
  const dateCreated = "Mon, 16 Nov 2026 12:00:00 GMT";
  const responses = [
    Response.json({ status: "pending", sid, date_created: dateCreated }),
    Response.json({ status: "pending", sid, date_created: dateCreated }),
    Response.json({ status: "pending", valid: false }),
    Response.json({ status: "approved", valid: true }),
  ];
  const requests: Request[] = [];
  const client = createTwilioVerifyClient({
    env,
    request: async (input, init) => {
      requests.push(new Request(input, init));
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
  });

  const pending = { status: "pending", sid, createdAt: Date.parse(dateCreated) };
  assert.deepEqual(await client.send(phone), pending);
  assert.deepEqual(await client.send(phone), pending);
  assert.equal(await client.check(sid, "222222"), "incorrect_code");
  assert.equal(await client.check(sid, code), "approved");

  for (const request of requests) {
    assert.equal(request.method, "POST");
    assert.equal(
      request.headers.get("Authorization"),
      `Basic ${Buffer.from(`${env.TWILIO_API_KEY_SID}:${env.TWILIO_API_KEY_SECRET}`).toString("base64")}`,
    );
  }
  for (const request of requests.slice(0, 2)) {
    assert.equal(request.url, `${baseUrl}/Verifications`);
    assert.deepEqual(Object.fromEntries(await request.formData()), { To: phone, Channel: "sms" });
  }
  assert.equal(requests[3].url, `${baseUrl}/VerificationCheck`);
  assert.deepEqual(Object.fromEntries(await requests[3].formData()), {
    VerificationSid: sid,
    Code: code,
  });
});

it("maps provider limits, terminal verifications, and destination and delivery failures", async () => {
  const responses = [
    Response.json({ code: 60205 }, { status: 403 }),
    Response.json({ code: 60605 }, { status: 403 }),
    Response.json({ code: 60203 }, { status: 429 }),
    Response.json({ code: 60410 }, { status: 403 }),
    Response.json({ status: "failed" }),
    Response.json({ code: 60202 }, { status: 429 }),
    Response.json({ code: 20404 }, { status: 404 }),
  ];
  const client = createTwilioVerifyClient({
    env,
    log: () => {},
    request: async () => {
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
  });
  assert.deepEqual(await client.send(phone), { status: "unsupported_destination" });
  assert.deepEqual(await client.send(phone), { status: "unsupported_destination" });
  assert.deepEqual(await client.send(phone), { status: "rate_limited" });
  assert.deepEqual(await client.send(phone), { status: "delivery_failed" });
  assert.deepEqual(await client.send(phone), { status: "delivery_failed" });
  assert.equal(await client.check(sid, code), "attempt_limit");
  assert.equal(await client.check(sid, code), "inactive");
});

it("logs only structured error metadata when Twilio or the network returns sensitive details", async () => {
  const logs: unknown[] = [];
  const sensitiveDetails = `${phone} ${code} ${sid} ${env.TWILIO_API_KEY_SID} ${env.TWILIO_API_KEY_SECRET}`;
  const client = createTwilioVerifyClient({
    env,
    log: (event, fields, level) => logs.push({ event, fields, level }),
    request: async (input) => {
      if (String(input).endsWith("Verifications")) throw new Error(sensitiveDetails);
      return Response.json({ code: 20003, message: sensitiveDetails }, { status: 401 });
    },
  });

  assert.deepEqual(await client.send(phone), { status: "unavailable" });
  assert.equal(await client.check(sid, code), "unavailable");
  assert.deepEqual(logs, [
    { event: "verify.request_failed", fields: { operation: "send" }, level: "warn" },
    {
      event: "verify.provider_error",
      fields: { operation: "check", httpStatus: 401, providerCode: 20003 },
      level: "warn",
    },
  ]);
});

it("uses credential names in configuration errors", () => {
  assert.throws(
    () => createTwilioVerifyClient({ env: {} }),
    /^Error: Invalid TWILIO_VERIFY_SERVICE_SID$/,
  );
  assert.throws(
    () => createTwilioVerifyClient({ env: { ...env, TWILIO_API_KEY_SECRET: "" } }),
    /^Error: Missing TWILIO_API_KEY_SECRET$/,
  );
});
