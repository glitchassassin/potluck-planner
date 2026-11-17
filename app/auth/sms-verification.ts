import { randomUUID } from "node:crypto";
import { sql, type Database, type SqlStatement } from "remix/data-table";

import {
  createTwilioVerifyClient,
  verifyRequestTimeoutMs,
  type VerifyClient,
  type VerifyFailure,
} from "./twilio-verify.ts";

const cooldownMs = 60_000;
const validityMs = 10 * 60_000;
const maxAttempts = 5;
// Recover an abandoned operation after a restart. Give the provider deadline time to elapse.
const operationLeaseMs = 3 * verifyRequestTimeoutMs;

const messages = {
  unsupported_destination: "Use a phone number that can receive SMS.",
  delivery_failed: "We couldn't send the code. Check the number and try again in a minute.",
  temporarily_blocked:
    "SMS verification is temporarily unavailable for this number. Try again later.",
  rate_limited: "SMS verification is temporarily rate limited. Wait a few minutes and try again.",
  unavailable: "SMS verification is temporarily unavailable. Try again in a minute.",
  cooldown: "Wait before requesting another code.",
  expired: "This verification code has expired. Wait before requesting another one.",
  busy: "A verification request is in progress. Try again shortly.",
  no_active_verification: "Request a new verification code.",
  attempt_limit: "Too many incorrect codes. Wait before requesting a new code.",
  incorrect_code: "That code is incorrect. Check the SMS and try again.",
  invalid_code: "Enter the numeric code from the SMS.",
};

function failure<Status extends keyof typeof messages>(status: Status) {
  return { status, message: messages[status] };
}

type Failure<Status extends keyof typeof messages> = { status: Status; message: string };
type AttemptLimit = Failure<"attempt_limit"> & { retryAt: number };

export type SendSmsResult =
  | { status: "sent"; expiresAt: number; retryAt: number }
  | (Failure<"cooldown"> & { retryAt: number })
  | (Failure<"expired"> & { retryAt: number })
  | AttemptLimit
  | Failure<VerifyFailure | "busy">;

export type CheckSmsResult =
  | { status: "verified" }
  | (Failure<"incorrect_code"> & { remainingAttempts: number })
  | AttemptLimit
  | Failure<VerifyFailure | "busy" | "no_active_verification" | "invalid_code">;

interface Verification {
  verification_sid: string | null;
  expires_at: number | null;
  failed_attempts: number;
  next_send_at: number;
}

/** Both operations take the canonical E.164 number from the caller's phone parser. */
export function createSmsVerificationService(
  db: Database<"sqlite">,
  {
    client = createTwilioVerifyClient(),
    now = Date.now,
  }: { client?: VerifyClient; now?: () => number } = {},
) {
  const columns = sql`verification_sid, expires_at, failed_attempts, next_send_at`;

  async function read(statement: SqlStatement) {
    const result = await db.exec(statement);
    return result.rows?.[0] as Verification | undefined;
  }

  function find(phoneE164: string) {
    return read(sql`select ${columns} from sms_verifications where phone_e164 = ${phoneE164}`);
  }

  async function finish(phoneE164: string, operationId: string, state: Verification) {
    const result = await db.exec(sql`
      update sms_verifications
      set verification_sid = ${state.verification_sid}, expires_at = ${state.expires_at},
          failed_attempts = ${state.failed_attempts}, operation_id = null, operation_expires_at = 0
      where phone_e164 = ${phoneE164} and operation_id = ${operationId}
    `);
    return result.affectedRows === 1;
  }

  return {
    async send(phoneE164: string): Promise<SendSmsResult> {
      if (!isE164(phoneE164)) return failure("unsupported_destination");
      const startedAt = now();
      const operationId = randomUUID();
      // Reserve the cooldown before calling Twilio because the SMS can be sent even if the response is lost.
      const state = await read(sql`
        insert into sms_verifications (phone_e164, next_send_at, operation_id, operation_expires_at)
        values (${phoneE164}, ${startedAt + cooldownMs}, ${operationId}, ${startedAt + operationLeaseMs})
        on conflict (phone_e164) do update set
          next_send_at = excluded.next_send_at,
          operation_id = excluded.operation_id,
          operation_expires_at = excluded.operation_expires_at
        where next_send_at <= ${startedAt} and operation_expires_at <= ${startedAt}
          and (failed_attempts < ${maxAttempts} or expires_at <= ${startedAt})
        returning ${columns}
      `);
      if (!state) {
        const current = await find(phoneE164);
        const limit = attemptLimit(current, startedAt);
        if (limit) return limit;
        if (current && current.next_send_at > startedAt) {
          return { ...failure("cooldown"), retryAt: current.next_send_at };
        }
        return failure("busy");
      }

      const response = await client.send(phoneE164);
      let result: SendSmsResult;
      if (response.status === "pending") {
        // Twilio can start a new verification while a resend crosses the old one's expiry.
        if (state.verification_sid !== response.sid || state.expires_at === null) {
          state.verification_sid = response.sid;
          state.expires_at = response.createdAt + validityMs;
          state.failed_attempts = 0;
        }
        result =
          state.expires_at > now()
            ? { status: "sent", expiresAt: state.expires_at, retryAt: state.next_send_at }
            : { ...failure("expired"), retryAt: state.next_send_at };
      } else if (response.status === "attempt_limit") {
        state.failed_attempts =
          state.expires_at !== null && state.expires_at > startedAt ? maxAttempts : 0;
        result = attemptLimit(state, startedAt) ?? failure("rate_limited");
      } else {
        result = failure(response.status);
      }
      return (await finish(phoneE164, operationId, state)) ? result : failure("busy");
    },

    async check(phoneE164: string, code: string): Promise<CheckSmsResult> {
      if (!isE164(phoneE164)) return failure("unsupported_destination");
      if (!/^\d{4,10}$/.test(code)) return failure("invalid_code");
      const startedAt = now();
      const operationId = randomUUID();
      const state = await read(sql`
        update sms_verifications
        set operation_id = ${operationId}, operation_expires_at = ${startedAt + operationLeaseMs}
        where phone_e164 = ${phoneE164} and operation_expires_at <= ${startedAt}
          and verification_sid is not null and expires_at > ${startedAt}
          and failed_attempts < ${maxAttempts}
        returning ${columns}
      `);
      if (!state?.verification_sid || state.expires_at === null) {
        const current = await find(phoneE164);
        const limit = attemptLimit(current, startedAt);
        if (limit) return limit;
        if (
          !current?.verification_sid ||
          current.expires_at === null ||
          current.expires_at <= startedAt
        ) {
          return failure("no_active_verification");
        }
        return failure("busy");
      }

      const response = await client.check(state.verification_sid, code);
      let result: CheckSmsResult;
      switch (response) {
        case "approved":
        case "inactive":
          state.verification_sid = null;
          state.expires_at = null;
          state.failed_attempts = 0;
          result =
            response === "approved" ? { status: "verified" } : failure("no_active_verification");
          break;
        case "incorrect_code":
        case "attempt_limit": {
          state.failed_attempts =
            response === "attempt_limit" ? maxAttempts : state.failed_attempts + 1;
          result = attemptLimit(state, startedAt) ?? {
            ...failure("incorrect_code"),
            remainingAttempts: maxAttempts - state.failed_attempts,
          };
          break;
        }
        default:
          result = failure(response);
      }
      return (await finish(phoneE164, operationId, state)) ? result : failure("busy");
    },
  };
}

function attemptLimit(state: Verification | undefined, now: number): AttemptLimit | undefined {
  if (state?.expires_at != null && state.expires_at > now && state.failed_attempts >= maxAttempts) {
    return { ...failure("attempt_limit"), retryAt: Math.max(state.expires_at, state.next_send_at) };
  }
}

function isE164(phone: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phone);
}
