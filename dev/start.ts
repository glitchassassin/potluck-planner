import { startServer } from "../server.ts";
import { createTwilioVerifyMock } from "./twilio-verify-mock.ts";

await startServer({
  verifyClient: createTwilioVerifyMock(),
  databasePath: "./db/mock.sqlite",
  host: "127.0.0.1",
});
