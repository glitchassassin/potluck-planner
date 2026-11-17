import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempDisposable } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, it } from "remix/test";

import { migrateDatabase, openDatabase } from "../db.ts";
import {
  createAccount,
  findAccountByPhone,
  readAdminPhoneAllowlist,
  resolveAccountRole,
} from "./accounts.ts";

describe("accounts", () => {
  it("persists one account per canonical number and permits duplicate names", async () => {
    await using directory = await mkdtempDisposable(join(tmpdir(), "potluck-accounts-"));
    const filename = join(directory.path, "new-data-folder", "accounts", "app.sqlite");
    const db = openDatabase(filename);
    let account;
    try {
      await migrateDatabase(db);
      account = await createAccount(db, {
        verifiedPhoneNumber: "(212) 555-0142",
        name: "  Alex  ",
      });
      assert.ok(account);
      assert.equal(account.verifiedPhoneNumber, "+12125550142");
      assert.equal(account.name, "Alex");
      assert.equal(
        await createAccount(db, { verifiedPhoneNumber: "1.212.555.0142", name: "Different" }),
        null,
      );

      const other = await createAccount(db, { verifiedPhoneNumber: "+12025550142", name: "Alex" });
      assert.ok(other);
      assert.notEqual(other.id, account.id);
      assert.equal(other.name, account.name);
      await assert.rejects(
        createAccount(db, { verifiedPhoneNumber: "+12125550143", name: " \t\n " }),
        /chosen name is required/,
      );
      await assert.rejects(
        createAccount(db, { verifiedPhoneNumber: "+14165550142", name: "Alex" }),
        /supported phone number is required/,
      );
    } finally {
      await db.close();
    }

    const reopened = openDatabase(filename);
    try {
      await migrateDatabase(reopened);
      assert.deepEqual(await findAccountByPhone(reopened, "212-555-0142"), account);
      assert.deepEqual(await findAccountByPhone(reopened, "+12125550142"), account);
      assert.equal(await findAccountByPhone(reopened, "+12125550143"), null);
    } finally {
      await reopened.close();
    }
  });

  it("allows a single signup across concurrent processes", async () => {
    await using directory = await mkdtempDisposable(join(tmpdir(), "potluck-accounts-"));
    const filename = join(directory.path, "app.sqlite");
    const db = openDatabase(filename);

    try {
      await migrateDatabase(db);
      const runSignup = promisify(execFile);
      const script = `
        import { openDatabase } from ${JSON.stringify(new URL("../db.ts", import.meta.url).href)};
        import { createAccount } from ${JSON.stringify(new URL("./accounts.ts", import.meta.url).href)};
        const [, filename, verifiedPhoneNumber, name] = process.argv;
        const db = openDatabase(filename);
        try {
          const account = await createAccount(db, { verifiedPhoneNumber, name });
          if (account) console.log(account.id);
        } finally {
          await db.close();
        }
      `;
      const signups = await Promise.all([
        runSignup(process.execPath, [
          "--input-type=module",
          "-e",
          script,
          filename,
          "(212) 555-0142",
          "Alex",
        ]),
        runSignup(process.execPath, [
          "--input-type=module",
          "-e",
          script,
          filename,
          "+12125550142",
          "Sam",
        ]),
      ]);
      const ids = signups.map(({ stdout }) => stdout.trim()).filter(Boolean);
      assert.equal(ids.length, 1);
      assert.equal((await findAccountByPhone(db, "2125550142"))?.id, ids[0]);
    } finally {
      await db.close();
    }
  });

  it("resolves Admin access from the current allowlist and the stored verified number", async () => {
    const db = openDatabase(":memory:");
    const previous = process.env.ADMIN_PHONE_ALLOWLIST;

    try {
      await migrateDatabase(db);
      const account = await createAccount(db, {
        verifiedPhoneNumber: "+12125550142",
        name: "Alex",
      });
      const other = await createAccount(db, { verifiedPhoneNumber: "+12125550143", name: "Alex" });
      assert.ok(account && other);

      delete process.env.ADMIN_PHONE_ALLOWLIST;
      assert.equal(resolveAccountRole(account), "user");

      process.env.ADMIN_PHONE_ALLOWLIST =
        " , (212) 555-0142, +1.212.555.0142, +14165550142, invalid, ";
      assert.deepEqual([...readAdminPhoneAllowlist()], ["+12125550142"]);
      assert.equal(resolveAccountRole(account), "admin");
      assert.equal(resolveAccountRole(other), "user");

      process.env.ADMIN_PHONE_ALLOWLIST = "";
      assert.equal(resolveAccountRole(account), "user");
    } finally {
      if (previous === undefined) {
        delete process.env.ADMIN_PHONE_ALLOWLIST;
      } else {
        process.env.ADMIN_PHONE_ALLOWLIST = previous;
      }
      await db.close();
    }
  });
});
