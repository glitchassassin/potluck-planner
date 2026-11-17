import { randomBytes } from "node:crypto";

import { createTwilioVerifyClient } from "../app/auth/twilio-verify.ts";

interface Verification {
  sid: string;
  phone: string;
  createdAt: number;
}

export function createTwilioVerifyMock(now = Date.now) {
  const pending = new Map<string, Verification>();
  const serviceSid = "VA" + "0".repeat(32);
  const baseUrl = `https://verify.twilio.com/v2/Services/${serviceSid}/`;

  const request: typeof fetch = async (input, init) => {
    const body = init?.body;
    if (init?.method !== "POST" || !(body instanceof URLSearchParams)) {
      return new Response(null, { status: 400 });
    }

    const timestamp = now();
    for (const [sid, verification] of pending) {
      if (verification.createdAt + 10 * 60_000 <= timestamp) pending.delete(sid);
    }

    if (input === baseUrl + "Verifications") {
      const phone = body.get("To");
      if (!phone || !/^\+1\d{10}$/.test(phone) || body.get("Channel") !== "sms") {
        return Response.json({ code: 60006 }, { status: 400 });
      }
      let verification = [...pending.values()].find((entry) => entry.phone === phone);
      if (!verification) {
        const sid = "VE" + randomBytes(16).toString("hex");
        verification = { sid, phone, createdAt: timestamp };
        pending.set(sid, verification);
      }
      return Response.json({
        sid: verification.sid,
        status: "pending",
        date_created: new Date(verification.createdAt).toISOString(),
      });
    }

    if (input === baseUrl + "VerificationCheck") {
      const sid = body.get("VerificationSid");
      if (!sid || !pending.has(sid)) return new Response(null, { status: 404 });
      if (body.get("Code") !== "000000") return Response.json({ status: "pending" });
      pending.delete(sid);
      return Response.json({ status: "approved" });
    }

    return new Response(null, { status: 404 });
  };

  return createTwilioVerifyClient({
    request,
    env: {
      TWILIO_VERIFY_SERVICE_SID: serviceSid,
      TWILIO_API_KEY_SID: "SK" + "0".repeat(32),
      TWILIO_API_KEY_SECRET: "mock",
    },
  });
}
