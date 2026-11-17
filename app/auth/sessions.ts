import { createHash, randomBytes } from "node:crypto";
import { createCookie, type Cookie } from "remix/cookie";
import { sql, type Database } from "remix/data-table";

import { createAccount, findAccountByPhone, type Account } from "./accounts.ts";
import { safeReturnPath } from "./route-guard.ts";

const sessionAge = 30 * 24 * 60 * 60;
const pendingAge = 20 * 60;
const signupAge = 10 * 60;

interface Flow {
  tokenHash: string;
  phone: string;
  verified: 0 | 1;
}

const flowColumns = sql`token_hash AS tokenHash, phone_e164 AS phone, verified`;

export function createSessions(
  db: Database<"sqlite">,
  { secure = process.env.NODE_ENV === "production", now = Date.now } = {},
) {
  const prefix = secure ? "__Host-" : "";
  const cookieOptions = { httpOnly: true, secure, sameSite: "Lax", path: "/" } as const;
  const flowCookie = createCookie(`${prefix}potluck_flow`, cookieOptions);
  const returnToCookie = createCookie(`${prefix}potluck_return_to`, {
    ...cookieOptions,
    encode: (value) => Buffer.from(value).toString("base64url"),
    decode: (value) => Buffer.from(value, "base64url").toString(),
  });
  const sessionCookie = createCookie(`${prefix}potluck_session`, {
    ...cookieOptions,
    maxAge: sessionAge,
  });

  function setReturnPath(path: string, maxAge: number): Promise<string> {
    return path === "/" ? clearCookie(returnToCookie) : returnToCookie.serialize(path, { maxAge });
  }

  async function startSession(tx: Database<"sqlite">, account: Account): Promise<string[]> {
    const token = newToken();
    const startedAt = now();
    await tx.exec(sql`DELETE FROM auth_sessions WHERE expires_at <= ${startedAt}`);
    await tx.exec(sql`
      INSERT INTO auth_sessions (token_hash, account_id, expires_at)
      VALUES (${hash(token)}, ${account.id}, ${startedAt + sessionAge * 1000})
    `);
    return [
      await sessionCookie.serialize(token),
      await clearCookie(flowCookie),
      await clearCookie(returnToCookie),
    ];
  }

  return {
    async readReturnPath(request: Request): Promise<string> {
      return safeReturnPath(await returnToCookie.parse(request.headers.get("Cookie")));
    },

    async readFlow(request: Request): Promise<Flow | null> {
      const tokenHash = await readTokenHash(flowCookie, request);
      if (!tokenHash) return null;
      const result = await db.exec(sql`
        SELECT ${flowColumns} FROM auth_flows
        WHERE token_hash = ${tokenHash} AND expires_at > ${now()}
      `);
      return (result.rows?.[0] as Flow | undefined) ?? null;
    },

    async startFlow(request: Request, phone: string, returnPath: string): Promise<string[]> {
      const previousHash = await readTokenHash(flowCookie, request);
      const token = newToken();
      const timestamp = now();
      await db.transaction(async (tx) => {
        await tx.exec(sql`
          DELETE FROM auth_flows WHERE expires_at <= ${timestamp} OR token_hash = ${previousHash}
        `);
        await tx.exec(sql`
          INSERT INTO auth_flows (token_hash, phone_e164, expires_at)
          VALUES (${hash(token)}, ${phone}, ${timestamp + pendingAge * 1000})
        `);
      });
      return [await flowCookie.serialize(token), await setReturnPath(returnPath, pendingAge)];
    },

    async extendPendingFlow(flow: Flow, returnPath: string): Promise<string | null> {
      const result = await db.exec(sql`
        UPDATE auth_flows SET expires_at = ${now() + pendingAge * 1000}
        WHERE token_hash = ${flow.tokenHash} AND verified = 0
      `);
      return result.affectedRows === 1 ? setReturnPath(returnPath, pendingAge) : null;
    },

    async finishVerification(flow: Flow, returnPath: string) {
      const token = newToken();
      const timestamp = now();
      return db.transaction(async (tx) => {
        // A new token is issued when the browser gains permission to finish signing up.
        const result = await tx.exec(sql`
          UPDATE auth_flows SET token_hash = ${hash(token)}, expires_at = ${
            timestamp + signupAge * 1000
          }, verified = 1
          WHERE token_hash = ${flow.tokenHash} AND expires_at > ${timestamp} AND verified = 0
          RETURNING ${flowColumns}
        `);
        const verified = result.rows?.[0] as Flow | undefined;
        if (!verified) return null;

        const account = await findAccountByPhone(tx, verified.phone);
        if (!account) {
          return {
            status: "choose_name" as const,
            cookies: [
              await flowCookie.serialize(token, { maxAge: signupAge }),
              await setReturnPath(returnPath, signupAge),
            ],
          };
        }

        await tx.exec(sql`DELETE FROM auth_flows WHERE token_hash = ${verified.tokenHash}`);
        return { status: "signed_in" as const, cookies: await startSession(tx, account) };
      });
    },

    async finishSignup(flow: Flow, name: string): Promise<string[] | null> {
      return db.transaction(async (tx) => {
        // Consume the proof in the same transaction that creates the account and session.
        const result = await tx.exec(sql`
          DELETE FROM auth_flows
          WHERE token_hash = ${flow.tokenHash} AND expires_at > ${now()} AND verified = 1
          RETURNING ${flowColumns}
        `);
        const verified = result.rows?.[0] as Flow | undefined;
        if (!verified) return null;

        const account =
          (await createAccount(tx, { verifiedPhoneNumber: verified.phone, name })) ??
          (await findAccountByPhone(tx, verified.phone));
        if (!account) throw new Error("Verified account could not be loaded");
        return startSession(tx, account);
      });
    },

    async readAccount(request: Request): Promise<Account | null> {
      const tokenHash = await readTokenHash(sessionCookie, request);
      if (!tokenHash) return null;
      const result = await db.exec(sql`
        SELECT accounts.id, accounts.verified_phone_number AS verifiedPhoneNumber, accounts.name
        FROM auth_sessions JOIN accounts ON accounts.id = auth_sessions.account_id
        WHERE auth_sessions.token_hash = ${tokenHash} AND auth_sessions.expires_at > ${now()}
      `);
      return (result.rows?.[0] as Account | undefined) ?? null;
    },

    async logout(request: Request): Promise<string[]> {
      const sessionHash = await readTokenHash(sessionCookie, request);
      const flowHash = await readTokenHash(flowCookie, request);
      await db.transaction(async (tx) => {
        if (sessionHash) {
          await tx.exec(sql`DELETE FROM auth_sessions WHERE token_hash = ${sessionHash}`);
        }
        if (flowHash) {
          await tx.exec(sql`DELETE FROM auth_flows WHERE token_hash = ${flowHash}`);
        }
      });
      return [
        await clearCookie(sessionCookie),
        await clearCookie(flowCookie),
        await clearCookie(returnToCookie),
      ];
    },
  };
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function readTokenHash(cookie: Cookie, request: Request): Promise<string | null> {
  const token = await cookie.parse(request.headers.get("Cookie"));
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? hash(token) : null;
}

function clearCookie(cookie: Cookie): Promise<string> {
  return cookie.serialize("", { maxAge: 0, expires: new Date(0) });
}
