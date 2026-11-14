import { randomUUID } from "node:crypto";
import type { RequestListener } from "node:http";
import { createRequestListener } from "remix/node-fetch-server";
import { createLogger, requestContext, type LogConfig, type RequestLogContext } from "./logger.ts";

type Handler = (request: Request) => Response | Promise<Response>;

export function createObservedListener(
  handler: Handler,
  config: LogConfig,
  options: { trustProxy?: boolean; log?: (line: string) => void } = {},
): RequestListener {
  const logger = createLogger(config, options.log);
  const listener = createRequestListener(
    async (request: Request) => {
      const context = requestContext.getStore()!;
      try {
        const response = await handler(request);
        context.handlerMs = performance.now() - context.started;
        const headers = new Headers(response.headers);
        headers.set("X-Request-ID", context.requestId);
        if (config.serverTiming !== "off") {
          const timings = [`app;dur=${context.handlerMs.toFixed(2)}`];
          if (config.serverTiming === "detailed") {
            for (const [name, duration] of Object.entries(context.operations))
              timings.push(`${name};dur=${duration.toFixed(2)}`);
          }
          headers.set("Server-Timing", timings.join(", "));
        } else {
          headers.delete("Server-Timing");
        }
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } finally {
        context.handlerMs ??= performance.now() - context.started;
      }
    },
    {
      trustProxy: options.trustProxy,
      onError(error) {
        logger("request.error", { error: String(error) }, "error");
        return new Response("Internal Server Error", { status: 500 });
      },
    },
  );

  return (request, response) => {
    const context: RequestLogContext = {
      requestId: randomUUID(),
      started: performance.now(),
      operations: Object.create(null) as Record<string, number>,
      config,
    };
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://localhost");
    } catch {
      url = new URL("http://localhost/");
    }
    const pathname = url.pathname;
    const query: Record<string, string[]> = Object.create(null);
    for (const [name, value] of url.searchParams) (query[name] ??= []).push(value);
    requestContext.run(context, () => {
      response.setHeader("X-Request-ID", context.requestId);
      let recorded = false;
      function complete(aborted: boolean) {
        if (recorded) return;
        recorded = true;
        if (config.requestDetail === "off") return;
        const level =
          aborted || response.statusCode >= 400
            ? response.statusCode >= 500
              ? "error"
              : "warn"
            : "info";
        // Event callbacks may run outside the originating async scope.
        requestContext.run(context, () =>
          logger(
            aborted ? "request.aborted" : "request.completed",
            {
              method: request.method,
              pathname,
              query,
              ...(aborted ? {} : { status: response.statusCode }),
              durationMs: Number((performance.now() - context.started).toFixed(2)),
              ...(context.handlerMs === undefined
                ? {}
                : { handlerMs: Number(context.handlerMs.toFixed(2)) }),
              ...(config.requestDetail === "detailed" ? { operations: context.operations } : {}),
            },
            level,
          ),
        );
      }
      response.once("finish", () => complete(false));
      response.once("close", () => complete(!response.writableFinished));
      listener(request, response);
    });
  };
}
