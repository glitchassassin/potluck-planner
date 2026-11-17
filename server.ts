import * as http from "node:http";
import { migrateDatabase, openDatabase } from "./app/db.ts";
import { createObservedListener } from "./app/observability/http.ts";
import { createLogger, readLogConfig } from "./app/observability/logger.ts";

import { assets } from "./app/assets.ts";
import { router } from "./app/router.ts";

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 44100;
const hmrProxyPort = process.env.HMR_PROXY_PORT
  ? Number.parseInt(process.env.HMR_PROXY_PORT, 10)
  : null;
const isHmr = process.env.REMIX_NODE_HMR === "1";

const config = readLogConfig();
const logger = createLogger(config);
const db = openDatabase();
await migrateDatabase(db);

const server = http.createServer(
  createObservedListener(router.fetch, config, { trustProxy: isHmr }),
);

server.listen(port, () => {
  if (isHmr) {
    import("remix/node-hmr/runtime").then((nodeHmr) => nodeHmr.emitServerReady());
  }

  logger("server.started", { port: hmrProxyPort ?? port }, "info");
});

let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger("server.stopping", {}, "info");
  server.close(() =>
    Promise.all([db.close(), assets.close()]).finally(() => process.exit(exitCode)),
  );
  server.closeAllConnections();
}

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

server.on("error", (error) => {
  logger("server.error", { error: String(error) }, "error");
  shutdown(1);
});
