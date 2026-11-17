import {
  createLogger,
  measure,
  readLogConfig,
  type LoggerFunction,
} from "../observability/logger.ts";

export type VerifyFailure =
  | "unsupported_destination"
  | "rate_limited"
  | "delivery_failed"
  | "temporarily_blocked"
  | "unavailable";

export interface VerifyClient {
  send(
    phoneE164: string,
  ): Promise<
    | { status: "pending"; sid: string; createdAt: number }
    | { status: "attempt_limit" | VerifyFailure }
  >;
  check(
    verificationSid: string,
    code: string,
  ): Promise<"approved" | "incorrect_code" | "attempt_limit" | "inactive" | VerifyFailure>;
}

export const verifyRequestTimeoutMs = 10_000;

type RequestFailure = { ok: false; httpStatus?: number; providerCode?: number };
type VerifyResponse = { ok: true; body: Record<string, unknown> } | RequestFailure;

export function createTwilioVerifyClient({
  env = process.env,
  request = fetch,
  log = createLogger(readLogConfig()),
}: {
  env?: NodeJS.ProcessEnv;
  request?: typeof fetch;
  log?: LoggerFunction;
} = {}): VerifyClient {
  const serviceSid = env.TWILIO_VERIFY_SERVICE_SID?.trim() ?? "";
  const apiKeySid = env.TWILIO_API_KEY_SID?.trim() ?? "";
  const apiKeySecret = env.TWILIO_API_KEY_SECRET?.trim() ?? "";
  if (!/^VA[0-9a-f]{32}$/i.test(serviceSid)) throw new Error("Invalid TWILIO_VERIFY_SERVICE_SID");
  if (!/^SK[0-9a-f]{32}$/i.test(apiKeySid)) throw new Error("Invalid TWILIO_API_KEY_SID");
  if (!apiKeySecret) throw new Error("Missing TWILIO_API_KEY_SECRET");

  const serviceUrl = `https://verify.twilio.com/v2/Services/${serviceSid}`;
  const authorization = `Basic ${Buffer.from(`${apiKeySid}:${apiKeySecret}`).toString("base64")}`;

  async function post(
    operation: "send" | "check",
    resource: "Verifications" | "VerificationCheck",
    fields: Record<string, string>,
  ): Promise<VerifyResponse> {
    try {
      const { response: http, body } = await measure(`verify_${operation}`, async () => {
        const response = await request(`${serviceUrl}/${resource}`, {
          method: "POST",
          headers: { Authorization: authorization },
          body: new URLSearchParams(fields),
          signal: AbortSignal.timeout(verifyRequestTimeoutMs),
          redirect: "error",
        });
        const body: unknown = await response.json().catch(() => null);
        return { response, body };
      });
      if (http.ok && body && typeof body === "object") {
        return { ok: true, body: body as Record<string, unknown> };
      }

      const code = body && typeof body === "object" && "code" in body ? body.code : undefined;
      const providerCode = typeof code === "number" && Number.isInteger(code) ? code : undefined;
      log("verify.provider_error", { operation, httpStatus: http.status, providerCode }, "warn");
      return { ok: false, httpStatus: http.status, providerCode };
    } catch {
      log("verify.request_failed", { operation }, "warn");
      return { ok: false };
    }
  }

  return {
    async send(phoneE164) {
      const result = await post("send", "Verifications", { To: phoneE164, Channel: "sms" });
      if (!result.ok) return { status: mapFailure(result) };

      const { sid, status, date_created: dateCreated } = result.body;
      if (status === "failed") return { status: "delivery_failed" };
      if (status === "max_attempts_reached") return { status: "attempt_limit" };
      const createdAt = typeof dateCreated === "string" ? Date.parse(dateCreated) : NaN;
      if (
        status === "pending" &&
        typeof sid === "string" &&
        /^VE[0-9a-f]{32}$/i.test(sid) &&
        Number.isFinite(createdAt)
      ) {
        return { status: "pending", sid, createdAt };
      }
      log("verify.unexpected_response", { operation: "send" }, "warn");
      return { status: "unavailable" };
    },

    async check(verificationSid, code) {
      const result = await post("check", "VerificationCheck", {
        VerificationSid: verificationSid,
        Code: code,
      });
      if (!result.ok) {
        // Twilio removes completed verifications and returns 404 for their SIDs.
        if (result.httpStatus === 404) return "inactive";
        return mapFailure(result);
      }

      switch (result.body.status) {
        case "approved":
          return "approved";
        case "pending":
          return "incorrect_code";
        case "max_attempts_reached":
          return "attempt_limit";
        case "expired":
        case "canceled":
        case "deleted":
        case "failed":
          return "inactive";
        default:
          log("verify.unexpected_response", { operation: "check" }, "warn");
          return "unavailable";
      }
    },
  };
}

function mapFailure({ httpStatus, providerCode }: RequestFailure): VerifyFailure | "attempt_limit" {
  switch (providerCode) {
    case 60202:
      return "attempt_limit";
    case 60006: // Invalid destination
    case 60008: // Unsupported carrier
    case 60205: // Landline
    case 60605: // Destination blocked by geographic permissions
    case 60610: // Outside coverage
    case 60612: // Not a mobile number
      return "unsupported_destination";
    case 60203:
    case 60212:
    case 60245:
    case 60624:
    case 60626:
      return "rate_limited";
    case 60410: // Fraud Guard
      return "temporarily_blocked";
    case 30003: // Unreachable handset
    case 30005: // Unknown destination handset
    case 30006: // Unreachable destination carrier
    case 30007: // Message filtered
    case 60238: // Verification blocked by Twilio
      return "delivery_failed";
    default:
      return httpStatus === 429 ? "rate_limited" : "unavailable";
  }
}
