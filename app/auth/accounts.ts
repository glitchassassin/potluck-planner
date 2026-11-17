import { randomUUID } from "node:crypto";
import { sql, type Database } from "remix/data-table";

import { parsePhoneNumber } from "./phone.ts";

export interface Account {
  id: string;
  verifiedPhoneNumber: string;
  name: string;
}

export type AccountRole = "user" | "admin";

const maxNameLength = 100;

export function validateAccountName(value: unknown): { name: string; error?: string } {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) return { name, error: "Enter the name you'd like others to see." };
  if (name.length > maxNameLength) {
    return { name, error: `Use ${maxNameLength} characters or fewer.` };
  }
  return { name };
}

function requireAccountName(value: string): string {
  const { name, error } = validateAccountName(value);
  if (error) throw new TypeError(name ? error : "A chosen name is required");
  return name;
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

  const name = requireAccountName(input.name);

  const account: Account = { id: randomUUID(), verifiedPhoneNumber, name };
  const result = await db.exec(sql`
    INSERT INTO accounts (id, verified_phone_number, name)
    VALUES (${account.id}, ${account.verifiedPhoneNumber}, ${account.name})
    ON CONFLICT (verified_phone_number) DO NOTHING
  `);

  return result.affectedRows === 1 ? account : null;
}

export async function updateAccountName(
  db: Database<"sqlite">,
  accountId: string,
  value: string,
): Promise<void> {
  const name = requireAccountName(value);
  await db.exec(sql`UPDATE accounts SET name = ${name} WHERE id = ${accountId}`);
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
