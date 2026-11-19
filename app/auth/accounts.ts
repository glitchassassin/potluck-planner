import { randomUUID } from "node:crypto";
import { sql, type Database } from "remix/data-table";

import { parsePhoneNumber } from "./phone.ts";

export interface Account {
  id: string;
  verifiedPhoneNumber: string;
  name: string;
}

export type AccountRole = "user" | "admin";

export interface AccountPermissions {
  isHost: boolean;
  isAdmin: boolean;
  canCreateEvents: boolean;
}

/** Creates an account after the caller verifies the phone number. Returns null for a duplicate. */
export async function createAccount(
  db: Database<"sqlite">,
  input: Omit<Account, "id">,
): Promise<Account | null> {
  const verifiedPhoneNumber = parsePhoneNumber(input.verifiedPhoneNumber);
  if (verifiedPhoneNumber === null) {
    throw new TypeError("A supported phone number is required");
  }

  const name = input.name.trim();
  if (name.length === 0) {
    throw new TypeError("A chosen name is required");
  }

  const account: Account = { id: randomUUID(), verifiedPhoneNumber, name };
  const result = await db.exec(sql`
    INSERT INTO accounts (id, verified_phone_number, name)
    VALUES (${account.id}, ${account.verifiedPhoneNumber}, ${account.name})
    ON CONFLICT (verified_phone_number) DO NOTHING
  `);

  return result.affectedRows === 1 ? account : null;
}

export async function findAccountByPhone(
  db: Database<"sqlite">,
  input: string,
): Promise<Account | null> {
  const phone = parsePhoneNumber(input);
  if (phone === null) {
    return null;
  }

  const result = await db.exec(sql`
    SELECT id, verified_phone_number AS verifiedPhoneNumber, name
    FROM accounts
    WHERE verified_phone_number = ${phone}
  `);

  const row = result.rows?.[0] as Account | undefined;
  return row ?? null;
}

/** Records the Host grant for an existing account. Returns false when the ID is unknown. */
export async function setHostGrant(
  db: Database<"sqlite">,
  accountId: Account["id"],
  granted: boolean,
): Promise<boolean> {
  const result = await db.exec(sql`
    UPDATE accounts SET has_host_grant = ${granted ? 1 : 0}
    WHERE id = ${accountId}
  `);
  return result.affectedRows === 1;
}

export function readAdminPhoneAllowlist(
  value = process.env.ADMIN_PHONE_ALLOWLIST,
): ReadonlySet<string> {
  const allowlist = new Set<string>();
  for (const entry of (value ?? "").split(",")) {
    const phone = parsePhoneNumber(entry);
    if (phone !== null) {
      allowlist.add(phone);
    }
  }

  return allowlist;
}

export function resolveAccountRole(account: Account): AccountRole {
  return readAdminPhoneAllowlist().has(account.verifiedPhoneNumber) ? "admin" : "user";
}

export function resolveAccountPermissions(account: Account, isHost: boolean): AccountPermissions {
  const isAdmin = resolveAccountRole(account) === "admin";
  return { isHost, isAdmin, canCreateEvents: isHost || isAdmin };
}
