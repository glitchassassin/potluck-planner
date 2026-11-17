import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMigrations } from "remix/data-table/migrations/node";
import { createSqliteDatabase, type SqliteDatabase } from "remix/data-table/sqlite";
import { it } from "remix/test";

import { createSmsVerificationService } from "./sms-verification.ts";
import type { VerifyClient } from "./twilio-verify.ts";

const phone = "+12125550142";
const correctCode = "012345";
const verificationSid = "VE" + "0".repeat(32);
const replacementSid = "VE" + "1".repeat(32);
const start = Date.parse("2026-11-16T12:00:00Z");
const expiry = start + 600_000;

async function fixture(
  run: (context: {
    open: () => SqliteDatabase;
    db: SqliteDatabase;
    client: VerifyClient;
    sent: string[];
    checked: string[];
    now: () => number;
    advanceTo: (time: number) => void;
  }) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "potluck-verify-"));
  const connections: SqliteDatabase[] = [];
  function open() {
    const db = createSqliteDatabase({ filename: join(directory, "app.sqlite"), busyTimeout: 5000 });
    connections.push(db);
    return db;
  }

  try {
    const db = open();
    const migrations = await loadMigrations(
      fileURLToPath(new URL("../../db/migrations/", import.meta.url)),
    );
    await db.migrate(migrations);
    let time = start;
    const sent: string[] = [];
    const checked: string[] = [];
    const client: VerifyClient = {
      async send(to) {
        sent.push(to);
        return time < expiry
          ? { status: "pending", sid: verificationSid, createdAt: start }
          : { status: "pending", sid: replacementSid, createdAt: time };
      },
      async check(sid, code) {
        checked.push(sid);
        return code === correctCode ? "approved" : "incorrect_code";
      },
    };
    await run({
      open,
      db,
      client,
      sent,
      checked,
      now: () => time,
      advanceTo: (timestamp) => (time = timestamp),
    });
  } finally {
    await Promise.all(connections.map((db) => db.close()));
    rmSync(directory, { recursive: true, force: true });
  }
}

it("persists the canonical number's 59- and 60-second cooldown across a restart", async () => {
  await fixture(async ({ db, open, client, sent, now, advanceTo }) => {
    const first = createSmsVerificationService(db, { client, now });
    assert.deepEqual(await first.send(phone), {
      status: "sent",
      expiresAt: expiry,
      retryAt: start + 60_000,
    });
    await db.close();

    const reopened = createSmsVerificationService(open(), { client, now });
    advanceTo(start + 59_000);
    const early = await reopened.send(phone);
    assert.equal(early.status, "cooldown");
    assert.equal(early.retryAt, start + 60_000);
    assert.deepEqual(sent, [phone]);

    advanceTo(start + 60_000);
    assert.deepEqual(await reopened.send(phone), {
      status: "sent",
      expiresAt: expiry,
      retryAt: start + 120_000,
    });
    assert.deepEqual(sent, [phone, phone]);
  });
});

it("only dispatches one concurrent send across separate SQLite connections", async () => {
  await fixture(async ({ db, open, client, sent, now }) => {
    const release = Promise.withResolvers<void>();
    const delayed: VerifyClient = {
      ...client,
      async send(to) {
        const result = await client.send(to);
        await release.promise;
        return result;
      },
    };
    const first = createSmsVerificationService(db, { client: delayed, now });
    const second = createSmsVerificationService(open(), { client, now });
    const inFlight = first.send(phone);
    try {
      assert.equal((await second.send(phone)).status, "busy");
      assert.deepEqual(sent, [phone]);
    } finally {
      release.resolve();
    }
    assert.equal((await inFlight).status, "sent");
  });
});

it("preserves the original expiry and failed-attempt count on resend", async () => {
  await fixture(async ({ db, open, client, checked, now, advanceTo }) => {
    const first = createSmsVerificationService(db, { client, now });
    await first.send(phone);
    assert.equal((await first.check(phone, "222222")).status, "incorrect_code");
    await db.close();

    advanceTo(start + 60_000);
    const restarted = createSmsVerificationService(open(), { client, now });
    const resent = await restarted.send(phone);
    assert.equal(resent.status, "sent");
    assert.equal(resent.expiresAt, expiry);
    const wrong = await restarted.check(phone, "222222");
    assert.equal(wrong.status, "incorrect_code");
    assert.equal(wrong.remainingAttempts, 3);

    advanceTo(expiry);
    assert.equal((await restarted.check(phone, correctCode)).status, "no_active_verification");
    assert.deepEqual(checked, [verificationSid, verificationSid]);
  });
});

it("uses the new SID and resets attempts when a resend creates a verification across expiry", async () => {
  await fixture(async ({ db, client, checked, now, advanceTo }) => {
    const first = createSmsVerificationService(db, { client, now });
    await first.send(phone);
    await first.check(phone, "222222");

    advanceTo(expiry - 1_000);
    const newCreatedAt = expiry + 1_000;
    const resendClient: VerifyClient = {
      ...client,
      async send(to) {
        advanceTo(newCreatedAt);
        return client.send(to);
      },
    };
    const service = createSmsVerificationService(db, { client: resendClient, now });
    const resent = await service.send(phone);
    assert.equal(resent.status, "sent");
    assert.equal(resent.expiresAt, newCreatedAt + 600_000);
    const wrong = await service.check(phone, "222222");
    assert.equal(wrong.status, "incorrect_code");
    assert.equal(wrong.remainingAttempts, 4);
    assert.equal((await service.check(phone, correctCode)).status, "verified");
    assert.deepEqual(checked, [verificationSid, replacementSid, replacementSid]);
  });
});

it("reports expiry when the same SID comes back after its original expiry", async () => {
  await fixture(async ({ db, client, checked, now, advanceTo }) => {
    const first = createSmsVerificationService(db, { client, now });
    await first.send(phone);

    advanceTo(expiry - 1_000);
    const lateClient: VerifyClient = {
      ...client,
      async send(to) {
        const response = await client.send(to);
        advanceTo(expiry);
        return response;
      },
    };
    const service = createSmsVerificationService(db, { client: lateClient, now });
    const result = await service.send(phone);
    assert.equal(result.status, "expired");
    assert.equal((await service.check(phone, correctCode)).status, "no_active_verification");
    assert.equal(
      (await createSmsVerificationService(db, { client, now }).send(phone)).status,
      "sent",
    );
    assert.deepEqual(checked, []);
  });
});

it("invalidates a code after five incorrect checks and allows a new code at expiry", async () => {
  await fixture(async ({ db, client, sent, checked, now, advanceTo }) => {
    const service = createSmsVerificationService(db, { client, now });
    await service.send(phone);
    for (const remaining of [4, 3, 2, 1]) {
      const result = await service.check(phone, "222222");
      assert.equal(result.status, "incorrect_code");
      assert.equal(result.remainingAttempts, remaining);
    }
    const exhausted = await service.check(phone, "222222");
    assert.equal(exhausted.status, "attempt_limit");
    assert.equal(exhausted.retryAt, expiry);
    assert.equal((await service.check(phone, correctCode)).status, "attempt_limit");

    advanceTo(expiry - 1);
    assert.equal((await service.send(phone)).status, "attempt_limit");
    assert.equal(checked.length, 5);
    assert.deepEqual(sent, [phone]);

    advanceTo(expiry);
    assert.equal((await service.send(phone)).status, "sent");
    const wrongForNewCode = await service.check(phone, "222222");
    assert.equal(wrongForNewCode.status, "incorrect_code");
    assert.equal(wrongForNewCode.remainingAttempts, 4);
  });
});

it("reports the later cooldown deadline when five failed checks follow a late resend", async () => {
  await fixture(async ({ db, client, now, advanceTo }) => {
    const service = createSmsVerificationService(db, { client, now });
    await service.send(phone);
    advanceTo(expiry - 10_000);
    assert.equal((await service.send(phone)).status, "sent");

    for (let attempt = 0; attempt < 4; attempt++) await service.check(phone, "222222");
    const exhausted = await service.check(phone, "222222");
    assert.equal(exhausted.status, "attempt_limit");
    assert.equal(exhausted.retryAt, expiry + 50_000);
    assert.deepEqual(await service.send(phone), exhausted);

    advanceTo(expiry);
    const cooldown = await service.send(phone);
    assert.equal(cooldown.status, "cooldown");
    assert.equal(cooldown.retryAt, exhausted.retryAt);
    advanceTo(exhausted.retryAt);
    assert.equal((await service.send(phone)).status, "sent");
  });
});

it("accepts an approved verification once across concurrent checks and a restart", async () => {
  await fixture(async ({ db, open, client, checked, now, advanceTo }) => {
    const release = Promise.withResolvers<void>();
    const delayed: VerifyClient = {
      ...client,
      async check(sid, code) {
        const result = await client.check(sid, code);
        await release.promise;
        return result;
      },
    };
    const first = createSmsVerificationService(db, { client: delayed, now });
    const second = createSmsVerificationService(open(), { client, now });
    await first.send(phone);
    advanceTo(start + 60_000);
    const inFlight = first.check(phone, correctCode);
    try {
      assert.equal((await second.check(phone, correctCode)).status, "busy");
      assert.equal((await second.send(phone)).status, "busy");
    } finally {
      release.resolve();
    }
    assert.equal((await inFlight).status, "verified");
    await db.close();
    assert.equal((await second.check(phone, correctCode)).status, "no_active_verification");
    assert.deepEqual(checked, [verificationSid]);
  });
});

it("allows retry after a provider failure and recovers an interrupted send when its lease expires", async () => {
  await fixture(async ({ db, open, client, now, advanceTo }) => {
    const failedDelivery: VerifyClient = {
      ...client,
      send: async () => ({ status: "delivery_failed" }),
    };
    const first = createSmsVerificationService(db, { client: failedDelivery, now });
    assert.equal((await first.send(phone)).status, "delivery_failed");
    assert.equal((await first.send(phone)).status, "delivery_failed");

    // The in-flight lease survives a restart even before a confirmed send sets the cooldown.
    const interrupted: VerifyClient = {
      ...client,
      send: async () => {
        throw new Error("Interrupted");
      },
    };
    const abandoned = createSmsVerificationService(db, { client: interrupted, now });
    await assert.rejects(abandoned.send(phone), /Interrupted/);
    await db.close();
    const restarted = createSmsVerificationService(open(), { client, now });
    advanceTo(start + 29_000);
    assert.equal((await restarted.send(phone)).status, "busy");
    advanceTo(start + 30_000);
    assert.equal((await restarted.send(phone)).status, "sent");
  });
});

it("rejects raw phone input and malformed codes at the service boundary", async () => {
  await fixture(async ({ db, client, sent, checked, now }) => {
    const service = createSmsVerificationService(db, { client, now });
    assert.equal((await service.send("(212) 555-0142")).status, "unsupported_destination");
    assert.equal((await service.send(phone)).status, "sent");
    assert.equal((await service.check(phone, "abc")).status, "invalid_code");
    assert.deepEqual(sent, [phone]);
    assert.deepEqual(checked, []);
  });
});

it("returns open-ended retry feedback for a temporary provider block", async () => {
  await fixture(async ({ db, client, now }) => {
    const blocked: VerifyClient = {
      ...client,
      send: async () => ({ status: "temporarily_blocked" }),
    };
    const service = createSmsVerificationService(db, { client: blocked, now });
    assert.deepEqual(await service.send(phone), {
      status: "temporarily_blocked",
      message: "SMS verification is temporarily unavailable for this number. Try again later.",
    });
  });
});
