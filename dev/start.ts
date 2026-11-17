import { createTwilioVerifyMock } from "./twilio-verify-mock.ts";

const testBuild = process.argv.includes("--production-build");
const entry = new URL(testBuild ? "../dist/server.ts" : "../server.ts", import.meta.url);
const { startServer } = (await import(entry.href)) as typeof import("../server.ts");

await startServer({
  verifyClient: createTwilioVerifyMock(),
  databasePath: testBuild ? ":memory:" : "./db/mock.sqlite",
  host: "127.0.0.1",
});
