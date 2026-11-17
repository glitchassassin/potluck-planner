import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { test as base } from "@playwright/test";

import type { AppCommand } from "./scenario.ts";

interface App {
  url: string;
  advanceTime(ms: number): Promise<void>;
  revokeInvitation(): Promise<void>;
}

// Every test (including retries) gets a fresh database, Verify mock, and clock.
export const test = base.extend<{ app: App }>({
  // Playwright reads fixture dependencies from the destructured first argument.
  // oxlint-disable-next-line no-empty-pattern
  async app({}, use) {
    const child = fork(new URL("./server.tsx", import.meta.url), {
      cwd: fileURLToPath(new URL("../../../dist/", import.meta.url)),
      execArgv: ["--import", "remix/node-tsx"],
      env: { NODE_ENV: "production", PORT: "0", LOG_LEVEL: "error" },
    });
    async function update(command: AppCommand) {
      const reply = receive(child);
      child.send(command);
      if ((await reply) !== "updated")
        throw new Error("Unexpected response from browser test server");
    }
    try {
      const port = await receive(child);
      if (typeof port !== "number") throw new Error("Browser test server did not report its port");
      await use({
        url: `http://127.0.0.1:${port}`,
        advanceTime: (ms) => update({ advanceMs: ms }),
        revokeInvitation: () => update("revokeInvitation"),
      });
    } finally {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
    }
  },
  async baseURL({ app }, use) {
    await use(app.url);
  },
});

async function receive(child: ChildProcess): Promise<unknown> {
  const stop = new AbortController();
  const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(10_000)]);
  try {
    return await Promise.race([
      once(child, "message", { signal }).then(([message]) => message),
      once(child, "exit", { signal }).then(([code, signal]) => {
        throw new Error(`Browser test server stopped with ${signal ?? `exit code ${code}`}`);
      }),
    ]);
  } finally {
    stop.abort();
  }
}
