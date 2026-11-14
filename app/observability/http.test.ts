import assert from "node:assert/strict";
import { createServer, get } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { describe, it } from "remix/test";
import { createObservedListener } from "./http.ts";
import { createLogger, measure, readLogConfig } from "./logger.ts";

async function withServer(
  handler: (request: Request) => Response | Promise<Response>,
  env: NodeJS.ProcessEnv,
  check: (url: string, records: Record<string, any>[]) => Promise<void>,
) {
  const records: Record<string, any>[] = [];
  const server = createServer(
    createObservedListener(handler, readLogConfig(env), {
      log: (line) => records.push(JSON.parse(line)),
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await check(`http://127.0.0.1:${address.port}`, records);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe("HTTP observability", () => {
  it("correlates concurrent requests, retains parameters unchanged with timing headers disabled", async () => {
    const appLogs: Record<string, any>[] = [];
    await withServer(
      async () => {
        const log = createLogger(readLogConfig({}), (line) => appLogs.push(JSON.parse(line)));
        await delay(5);
        log("test.operation", {}, "info");
        return new Response("ok");
      },
      {},
      async (url, records) => {
        const responses = await Promise.all([
          fetch(`${url}/invite/private-token?code=123456&phone=%2B12125550142&tag=a&tag=b`),
          fetch(`${url}/invite/other-token`),
        ]);
        await Promise.all(responses.map((response) => response.text()));
        assert.equal(records.length, 2);
        const ids = responses.map((response) => response.headers.get("X-Request-ID"));
        assert.equal(new Set(ids).size, 2);
        for (const response of responses) assert.equal(response.headers.get("Server-Timing"), null);
        assert.deepEqual(new Set(appLogs.map((record) => record.requestId)), new Set(ids));
        for (const record of records) {
          assert.equal(record.status, 200);
          assert.ok(record.durationMs >= record.handlerMs);
          assert.equal(record.operations, undefined);
        }
        const first = records.find((record) => record.pathname === "/invite/private-token")!;
        assert.deepEqual(first.query.code, ["123456"]);
        assert.deepEqual(first.query.phone, ["+12125550142"]);
        assert.deepEqual(first.query.tag, ["a", "b"]);
        assert.ok(records.some((record) => record.pathname === "/invite/other-token"));
      },
    );
  });

  it("distinguishes streaming completion from handler time and exposes detailed timings only when enabled", async () => {
    await withServer(
      async () => {
        await measure("db", () => delay(5));
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("first"));
              setTimeout(() => {
                controller.enqueue(new TextEncoder().encode("last"));
                controller.close();
              }, 60);
            },
          }),
        );
      },
      { REQUEST_LOG_DETAIL: "detailed", SERVER_TIMING: "detailed" },
      async (url, records) => {
        const response = await fetch(url);
        assert.match(response.headers.get("Server-Timing")!, /app;dur=[\d.]+, db;dur=[\d.]+/);
        assert.equal(await response.text(), "firstlast");
        assert.equal(records.length, 1);
        assert.ok(records[0].durationMs - records[0].handlerMs >= 20);
        assert.ok(records[0].operations.db >= 0);
      },
    );
  });

  it("exposes only application duration in summary headers", async () => {
    await withServer(
      async () => {
        await measure("db", () => delay(1));
        return new Response("ok");
      },
      { SERVER_TIMING: "summary" },
      async (url, records) => {
        const response = await fetch(url);
        await response.text();
        assert.match(response.headers.get("Server-Timing")!, /^app;dur=[\d.]+$/);
        assert.equal(records[0].operations, undefined);
      },
    );
  });

  it("records stream failures after headers are sent", async () => {
    await withServer(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("first"));
              setTimeout(() => controller.error(new Error("code=123456 phone=+12125550142")), 20);
            },
          }),
        ),
      {},
      async (url, records) => {
        const response = await fetch(url);
        await assert.rejects(response.text());
        for (
          let attempt = 0;
          !records.some((record) => record.event === "request.aborted") && attempt < 50;
          attempt++
        )
          await delay(5);
        assert.equal(records.filter((record) => record.event === "request.error").length, 1);
        assert.equal(records.filter((record) => record.event === "request.aborted").length, 1);
        assert.doesNotMatch(JSON.stringify(records), /12125550142/);
        assert.match(JSON.stringify(records), /code=123456 phone=\*\*\*42/);
      },
    );
  });

  it("keeps error messages with masked phones when request summaries are disabled", async () => {
    await withServer(
      () => {
        throw new Error("verificationCode=123456 invitation=private-token phone=+12125550142");
      },
      { REQUEST_LOG_DETAIL: "off" },
      async (url, records) => {
        const response = await fetch(url);
        assert.equal(response.status, 500);
        assert.ok(response.headers.get("X-Request-ID"));
        assert.equal(await response.text(), "Internal Server Error");
        assert.equal(records.length, 1);
        assert.equal(records[0].event, "request.error");
        assert.equal(records[0].requestId, response.headers.get("X-Request-ID"));
        assert.equal(
          records[0].error,
          "Error: verificationCode=123456 invitation=private-token phone=***42",
        );
      },
    );
  });

  it("logs one aborted response without a misleading completion status", async () => {
    await withServer(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("first"));
            },
          }),
        ),
      {},
      async (url, records) => {
        await new Promise<void>((resolve, reject) => {
          const request = get(url, (response) =>
            response.once("data", () => {
              response.destroy();
              resolve();
            }),
          );
          request.on("error", reject);
        });
        for (let attempt = 0; records.length === 0 && attempt < 50; attempt++) await delay(5);
        assert.equal(records.length, 1);
        assert.equal(records[0].event, "request.aborted");
        assert.equal(records[0].status, undefined);
      },
    );
  });
});
