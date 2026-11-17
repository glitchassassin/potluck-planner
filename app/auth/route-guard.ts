import { createContextKey, type Middleware } from "remix/router";
import { redirect } from "remix/response/redirect";

import { routes } from "../routes.ts";
import type { Account } from "./accounts.ts";
import type { createSessions } from "./sessions.ts";

export const CurrentAccount = createContextKey<Account>();

export function requireAccount(
  sessions: Pick<ReturnType<typeof createSessions>, "readAccount">,
): Middleware<{ key: typeof CurrentAccount; value: Account; property: "account" }> {
  return async (context, next) => {
    const account = await sessions.readAccount(context.request);
    if (!account) return authRedirect(signInHref(context.url.pathname + context.url.search));

    context.set(CurrentAccount, account, { property: "account" });
    const response = await next();
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

export function signInHref(returnPath: string): string {
  const path = routes.signIn.phone.index.href();
  return returnPath === "/" ? path : `${path}?${new URLSearchParams({ returnTo: returnPath })}`;
}

export function safeReturnPath(value: string | null): string {
  // Reject characters stripped or interpreted as separators by the browser's URL parser.
  // oxlint-disable-next-line no-control-regex
  if (!value?.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) {
    return "/";
  }
  const url = new URL(value, "https://potluck.invalid");
  // Dot-segment normalization can produce a pathname beginning with two slashes.
  return url.pathname.startsWith("//") ? "/" : url.pathname + url.search;
}

export function authRedirect(path: string, cookies: string[] = []): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return redirect(path, { status: 303, headers });
}
