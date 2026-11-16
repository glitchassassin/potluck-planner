import { createRouter, type RouterContext } from "remix/router";
import { render } from "remix/middleware/render";
import { staticFiles } from "remix/middleware/static";

import { logger } from "./observability/logger.ts";

import controller from "./actions/controller.tsx";
import { assets } from "./assets.ts";
import { routes } from "./routes.ts";

export const router = createRouter({
  middleware: [logger(), staticFiles("./public", { index: false }), render({ assets })],
});

export type AppContext = RouterContext<typeof router>;

declare module "remix" {
  interface RouterTypes {
    context: AppContext;
  }
}

router.map(routes, controller);

if (process.env.NODE_ENV === "development") {
  const { kitchenSinkRoute, kitchenSink } = await import("../dev/kitchen-sink.tsx");
  router.map(kitchenSinkRoute, kitchenSink);
}
