import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { it } from "remix/test";

it("exits with failure after a port conflict even with development asset watching", async () => {
  const occupied = createServer();
  occupied.listen(0);
  await once(occupied, "listening");
  const address = occupied.address();
  assert.ok(address && typeof address !== "string");
  const child = spawn(process.execPath, ["--import", "remix/node-tsx", "server.ts"], {
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(address.port),
      DATABASE_PATH: ":memory:",
      TWILIO_VERIFY_SERVICE_SID: "VA" + "0".repeat(32),
      TWILIO_API_KEY_SID: "SK" + "0".repeat(32),
      TWILIO_API_KEY_SECRET: "unused",
      LOG_LEVEL: "info",
      REMIX_NODE_HMR: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => (output += data));
  child.stderr.on("data", (data) => (output += data));
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const [code, signal] = await once(child, "exit");
    assert.equal(signal, null, output);
    assert.equal(code, 1, output);
    assert.match(output, /"event":"server.error"/);
    assert.match(output, /EADDRINUSE/);
  } finally {
    clearTimeout(timeout);
    child.kill("SIGKILL");
    await new Promise<void>((resolve, reject) =>
      occupied.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
