import assert from "node:assert/strict";
import { createRouter } from "remix/router";
import { Logger as RemixLogger } from "remix/middleware/logger";
import { describe, it } from "remix/test";
import { createLogger, logger, Logger, readLogConfig, sanitize } from "./logger.ts";

describe("logging privacy and configuration", () => {
  it("logs bigint values and cycles without breaking a request", async () => {
    const lines: string[] = [];
    const log = createLogger(readLogConfig({}), (line) => lines.push(line));
    const shared = { phone: "+12125550142", id: 123n };
    const cyclic: Record<string, unknown> = { shared };
    cyclic.self = cyclic;
    const array: unknown[] = [];
    array.push(array);
    const router = createRouter({ middleware: [logger({ log })] });
    router.get("/", (context) => {
      context.logger("db.result", { cyclic, array, first: shared, second: shared });
      return new Response("ok");
    });
    assert.equal((await router.fetch("http://localhost/")).status, 200);
    const record = JSON.parse(lines[0]);
    assert.deepEqual(record.cyclic, {
      shared: { phone: "***42", id: "123" },
      self: "[Circular]",
    });
    assert.deepEqual(record.array, ["[Circular]"]);
    assert.deepEqual(record.first, record.cyclic.shared);
    assert.deepEqual(record.second, record.first);
    assert.equal(cyclic.self, cyclic);
    assert.equal(shared.id, 123n);
  });

  it("provides Remix-compatible context.logger and the same Logger context key", async () => {
    const lines: string[] = [];
    const log = createLogger(readLogConfig({}), (line) => lines.push(line));
    const router = createRouter({ middleware: [logger({ log })] });
    router.get("/", (context) => {
      assert.equal(context.logger, context.get(Logger));
      assert.equal(context.logger, context.get(RemixLogger));
      context.logger("app.ready");
      context.get(Logger)("app.warning", { phone: "+12125550142" }, "warn");
      context.get(RemixLogger)("app.native");
      return new Response("ok");
    });
    assert.equal((await router.fetch("http://localhost/")).status, 200);
    assert.deepEqual(
      lines.map((line) => JSON.parse(line).event),
      ["app.ready", "app.warning", "app.native"],
    );
    assert.equal(JSON.parse(lines[1]).level, "warn");
    assert.equal(JSON.parse(lines[1]).phone, "***42");
  });

  it("leaves request path and query parameters untouched", () => {
    const lines: string[] = [];
    const log = createLogger(readLogConfig({}), (line) => lines.push(line));
    log("request.test", {
      pathname: "/users/+12125550142",
      query: { phone: ["+12125550142"], code: ["123456"] },
      phone: "+12125550142",
    });
    const record = JSON.parse(lines[0]);
    assert.equal(record.pathname, "/users/+12125550142");
    assert.deepEqual(record.query, { phone: ["+12125550142"], code: ["123456"] });
    assert.equal(record.phone, "***42");
  });

  it("defaults to info summaries with timing headers disabled and rejects invalid settings", () => {
    assert.deepEqual(readLogConfig({}), {
      level: "info",
      requestDetail: "summary",
      serverTiming: "off",
    });
    for (const level of ["trace", "fatal"]) {
      assert.throws(() => readLogConfig({ LOG_LEVEL: level }), /Invalid LOG_LEVEL/);
    }
    for (const key of ["LOG_LEVEL", "REQUEST_LOG_DETAIL", "SERVER_TIMING"]) {
      assert.throws(() => readLogConfig({ [key]: "invalid" }), new RegExp(key));
    }
  });

  it("only masks phone numbers in strings, including nested values", () => {
    for (const phone of ["+12125550142", "(212) 555-0142", "212.555.0142"]) {
      assert.equal(sanitize(`Contact ${phone}`), "Contact ***42");
    }
    assert.deepEqual(
      sanitize({
        phoneNumber: 12125550142,
        nested: [{ phone: "+12125550142", verificationCode: "123456", token: "invite-token" }],
        headers: { cookie: "session-secret" },
        active: true,
        empty: null,
      }),
      {
        phoneNumber: 12125550142,
        nested: [{ phone: "***42", verificationCode: "123456", token: "invite-token" }],
        headers: { cookie: "session-secret" },
        active: true,
        empty: null,
      },
    );
  });

  it("masks phone strings at every severity", () => {
    const lines: string[] = [];
    const logger = createLogger(readLogConfig({ LOG_LEVEL: "debug" }), (line) => lines.push(line));
    for (const level of ["debug", "info", "warn", "error"] as const) {
      logger(
        "privacy.test",
        {
          phone: "+12125550142",
          code: "123456",
          sessionId: "private-session",
        },
        level,
      );
    }
    assert.equal(lines.length, 4);
    for (const line of lines) {
      assert.doesNotMatch(line, /12125550142/);
      assert.equal(JSON.parse(line).code, "123456");
      assert.equal(JSON.parse(line).sessionId, "private-session");
      assert.equal(JSON.parse(line).phone, "***42");
    }
  });

  it("filters levels, emits JSON lines, and protects reserved metadata", () => {
    const lines: string[] = [];
    const logger = createLogger(readLogConfig({ LOG_LEVEL: "warn" }), (line) => lines.push(line));
    logger("ignored", {}, "info");
    logger("test.warning", { level: "fake", phone: "+12125550142" }, "warn");
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).level, "warn");
    assert.equal(JSON.parse(lines[0]).phone, "***42");
    createLogger(readLogConfig({ LOG_LEVEL: "silent" }), () =>
      assert.fail("silent logger wrote output"),
    )("ignored", {}, "error");
  });
});
