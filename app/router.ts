import type { Database } from "remix/data-table";
import { cop } from "remix/middleware/cop";
import { formData } from "remix/middleware/form-data";
import { render } from "remix/middleware/render";
import { staticFiles } from "remix/middleware/static";
import { createRouter, type RouterContext } from "remix/router";

import { createHomeAction, serveAsset } from "./actions/controller.tsx";
import { createSignInController } from "./actions/sign-in-controller.tsx";
import { assets } from "./assets.ts";
import { createSessions } from "./auth/sessions.ts";
import { createSignInLimits } from "./auth/sign-in-limits.ts";
import { createSmsVerificationService } from "./auth/sms-verification.ts";
import type { VerifyClient } from "./auth/twilio-verify.ts";
import { logger } from "./observability/logger.ts";
import { routes } from "./routes.ts";

export async function createAppRouter({
  db,
  verifyClient,
  now = Date.now,
}: {
  db: Database<"sqlite">;
  verifyClient: VerifyClient;
  now?: () => number;
}) {
  const router = createRouter({
    middleware: [
      logger(),
      staticFiles("./public", { index: false }),
      cop(),
      formData({ maxParts: 8, maxTotalSize: 16 * 1024 }),
      render({ assets }),
    ],
  });
  const sessions = createSessions(db, { now });
  const sms = createSmsVerificationService(db, { client: verifyClient, now });
  const signIn = createSignInController({ sessions, sms, limit: createSignInLimits(db, now), now });

  router.map(routes.assets, serveAsset);
  router.map(routes.home, createHomeAction(sessions));
  router.map(routes.signIn.phone, signIn.phone);
  router.map(routes.signIn.code, signIn.code);
  router.map(routes.signIn.resend, signIn.resend);
  router.map(routes.signIn.name, signIn.name);
  router.map(routes.signIn.logout, signIn.logout);

  if (process.env.NODE_ENV === "development") {
    const { kitchenSinkRoute, kitchenSink } = await import("../dev/kitchen-sink.tsx");
    router.map(kitchenSinkRoute, kitchenSink);
  }

  return router;
}

export type AppContext = RouterContext<Awaited<ReturnType<typeof createAppRouter>>>;

declare module "remix" {
  interface RouterTypes {
    context: AppContext;
  }
}
