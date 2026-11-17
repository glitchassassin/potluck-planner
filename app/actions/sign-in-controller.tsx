import { createAction, createController, type Middleware } from "remix/router";

import { validateAccountName } from "../auth/accounts.ts";
import { formatPhoneNumber, parsePhoneNumber } from "../auth/phone.ts";
import { authRedirect, safeReturnPath, signInHref } from "../auth/route-guard.ts";
import type { createSessions } from "../auth/sessions.ts";
import type { createSignInLimits } from "../auth/sign-in-limits.ts";
import type { createSmsVerificationService } from "../auth/sms-verification.ts";
import { routes } from "../routes.ts";
import { CodePage, maxPhoneLength, NamePage, PhonePage } from "./sign-in-pages.tsx";

export interface SignInDependencies {
  sessions: ReturnType<typeof createSessions>;
  sms: ReturnType<typeof createSmsVerificationService>;
  limit: ReturnType<typeof createSignInLimits>;
  now: () => number;
}

const noStore: Middleware = async (_context, next) => {
  const response = await next();
  response.headers.set("Cache-Control", "no-store");
  return response;
};

export function createSignInController({ sessions, sms, limit, now }: SignInDependencies) {
  return {
    phone: createController(routes.signIn.phone, {
      middleware: [noStore],
      actions: {
        async index(context) {
          const returnPath = safeReturnPath(context.url.searchParams.get("returnTo"));
          if (await sessions.readAccount(context.request)) return authRedirect(returnPath);
          return context.render(<PhonePage returnPath={returnPath} />);
        },
        async action(context) {
          const returnPath = safeReturnPath(formValue(context.formData, "returnTo"));
          if (await sessions.readAccount(context.request)) return authRedirect(returnPath);

          const value = formValue(context.formData, "phone");
          const phone = value.length <= maxPhoneLength ? parsePhoneNumber(value) : null;
          if (!phone) {
            return context.render(
              <PhonePage
                returnPath={returnPath}
                value={value.slice(0, maxPhoneLength)}
                error="Enter a supported phone number."
              />,
              { status: 400 },
            );
          }

          const result = (await limit(context.request, "send")) ?? (await sms.send(phone));
          if (result.status !== "sent") {
            return context.render(
              <PhonePage returnPath={returnPath} value={value} error={withRetry(result, now())} />,
              errorResponse(result, now()),
            );
          }
          const cookies = await sessions.startFlow(context.request, phone, returnPath);
          return authRedirect(routes.signIn.code.index.href(), cookies);
        },
      },
    }),
    code: createController(routes.signIn.code, {
      middleware: [noStore],
      actions: {
        async index(context) {
          const flow = await sessions.readFlow(context.request);
          const returnPath = await sessions.readReturnPath(context.request);
          if (!flow) return authRedirect(signInHref(returnPath));
          if (flow.verified) return authRedirect(routes.signIn.name.index.href());
          return context.render(
            <CodePage
              destination={formatPhoneNumber(flow.phone)!}
              returnPath={returnPath}
              resent={context.url.searchParams.get("resent") === "1"}
            />,
          );
        },
        async action(context) {
          const flow = await sessions.readFlow(context.request);
          const returnPath = await sessions.readReturnPath(context.request);
          if (!flow) return authRedirect(signInHref(returnPath));
          if (flow.verified) return authRedirect(routes.signIn.name.index.href());

          const result =
            (await limit(context.request, "check")) ??
            (await sms.check(flow.phone, formValue(context.formData, "code").trim()));
          if (result.status !== "verified") {
            return context.render(
              <CodePage
                destination={formatPhoneNumber(flow.phone)!}
                returnPath={returnPath}
                error={withRetry(result, now())}
              />,
              errorResponse(result, now()),
            );
          }

          const signIn = await sessions.finishVerification(flow, returnPath);
          if (!signIn) return authRedirect(signInHref(returnPath));
          if (signIn.status === "choose_name") {
            return authRedirect(routes.signIn.name.index.href(), signIn.cookies);
          }
          return authRedirect(returnPath, signIn.cookies);
        },
      },
    }),
    resend: createAction(routes.signIn.resend, {
      middleware: [noStore],
      async handler(context) {
        const flow = await sessions.readFlow(context.request);
        const returnPath = await sessions.readReturnPath(context.request);
        if (!flow) return authRedirect(signInHref(returnPath));
        if (flow.verified) return authRedirect(routes.signIn.name.index.href());

        const result = (await limit(context.request, "send")) ?? (await sms.send(flow.phone));
        if (result.status !== "sent") {
          return context.render(
            <CodePage
              destination={formatPhoneNumber(flow.phone)!}
              returnPath={returnPath}
              resendError={withRetry(result, now())}
            />,
            errorResponse(result, now()),
          );
        }

        const cookie = await sessions.extendPendingFlow(flow, returnPath);
        return authRedirect(routes.signIn.code.index.href() + "?resent=1", cookie ? [cookie] : []);
      },
    }),
    name: createController(routes.signIn.name, {
      middleware: [noStore],
      actions: {
        async index(context) {
          const flow = await sessions.readFlow(context.request);
          if (!flow?.verified) {
            return authRedirect(signInHref(await sessions.readReturnPath(context.request)));
          }
          return context.render(<NamePage />);
        },
        async action(context) {
          const flow = await sessions.readFlow(context.request);
          const returnPath = await sessions.readReturnPath(context.request);
          if (!flow?.verified) return authRedirect(signInHref(returnPath));

          const { name, error } = validateAccountName(context.formData.get("name"));
          if (error) {
            return context.render(<NamePage error={error} />, { status: 400 });
          }
          const cookies = await sessions.finishSignup(flow, name);
          if (!cookies) return authRedirect(signInHref(returnPath));
          return authRedirect(returnPath, cookies);
        },
      },
    }),
    logout: createAction(routes.signIn.logout, {
      async handler(context) {
        const cookies = await sessions.logout(context.request);
        return authRedirect(signInHref("/"), cookies);
      },
    }),
  };
}

function formValue(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function withRetry(result: { message: string; retryAt?: number }, now: number): string {
  if (result.retryAt === undefined || result.retryAt <= now) return result.message;
  const seconds = Math.ceil((result.retryAt - now) / 1000);
  const count = seconds < 60 ? seconds : Math.ceil(seconds / 60);
  const unit = seconds < 60 ? "second" : "minute";
  const wait = `${count} ${unit}${count === 1 ? "" : "s"}`;
  return `${result.message} Try again in ${wait}.`;
}

function failureStatus(status: string): number {
  switch (status) {
    case "cooldown":
    case "rate_limited":
    case "attempt_limit":
      return 429;
    case "unavailable":
      return 503;
    default:
      return 400;
  }
}

function errorResponse(result: { status: string; retryAt?: number }, now: number): ResponseInit {
  const status = failureStatus(result.status);
  const headers =
    status === 429 && result.retryAt !== undefined
      ? { "Retry-After": String(Math.max(0, Math.ceil((result.retryAt - now) / 1000))) }
      : undefined;
  return { status, headers };
}
