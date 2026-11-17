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
        return { status: "pending", sid: verificationSid, createdAt: time < expiry ? start : time };
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
      assert.equal((await second.send(phone)).status, "cooldown");
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

it("keeps the cooldown after a failed send or a lost response", async () => {
  await fixture(async ({ db, open, client, now, advanceTo }) => {
    const failedDelivery: VerifyClient = {
      ...client,
      send: async () => ({ status: "delivery_failed" }),
    };
    const first = createSmsVerificationService(db, { client: failedDelivery, now });
    assert.equal((await first.send(phone)).status, "delivery_failed");
    assert.equal((await first.send(phone)).status, "cooldown");

    advanceTo(start + 60_000);
    // The reservation survives if the operation stops before it can record Twilio's response.
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
    advanceTo(start + 119_000);
    assert.equal((await restarted.send(phone)).status, "cooldown");
    advanceTo(start + 120_000);
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
