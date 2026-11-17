import { createHash } from "node:crypto";
import { sql, type Database } from "remix/data-table";

import { clientIps } from "../observability/client-ip.ts";

const windowMs = 10 * 60_000;
const maxAttempts = { send: 10, check: 30 };
const messages = {
  send: "Too many code requests from your network.",
  check: "Too many verification attempts from your network.",
};

export function createSignInLimits(db: Database<"sqlite">, now = Date.now) {
  return async (request: Request, action: keyof typeof maxAttempts) => {
    const timestamp = now();
    const ipHash = createHash("sha256")
      .update(clientIps.get(request) || "unknown")
      .digest("hex");
    const max = maxAttempts[action];
    await db.exec(sql`DELETE FROM sign_in_limits WHERE resets_at <= ${timestamp}`);
    const result = await db.exec(sql`
      INSERT INTO sign_in_limits (ip_hash, action, attempts, resets_at)
      VALUES (${ipHash}, ${action}, 1, ${timestamp + windowMs})
      ON CONFLICT (ip_hash, action) DO UPDATE SET
        attempts = CASE
          WHEN sign_in_limits.resets_at <= ${timestamp} THEN 1
          ELSE min(sign_in_limits.attempts + 1, ${max + 1})
        END,
        resets_at = CASE
          WHEN sign_in_limits.resets_at <= ${timestamp} THEN excluded.resets_at
          ELSE sign_in_limits.resets_at
        END
      RETURNING attempts, resets_at
    `);
    const { attempts, resets_at: retryAt } = result.rows![0] as {
      attempts: number;
      resets_at: number;
    };
    return attempts > max
      ? { status: "rate_limited" as const, message: messages[action], retryAt }
      : null;
  };
}
