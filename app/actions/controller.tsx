import { createAction } from "remix/router";

import { assets } from "../assets.ts";
import { requireAccount } from "../auth/route-guard.ts";
import type { createSessions } from "../auth/sessions.ts";
import { routes } from "../routes.ts";
import { HomePage } from "./home-page.tsx";

export const serveAsset = createAction(routes.assets, async (context) => {
  return (await assets.fetch(context.request)) ?? new Response("Not Found", { status: 404 });
});

export function createHomeAction(sessions: ReturnType<typeof createSessions>) {
  return createAction(routes.home, {
    middleware: [requireAccount(sessions)],
    handler(context) {
      return context.render(<HomePage name={context.account.name} />);
    },
  });
}
