import { once } from "node:events";

import { createTwilioVerifyMock } from "../../../dev/twilio-verify-mock.ts";
import {
  eventPath,
  invitationPath,
  newAccount,
  returningAccount,
  type AppCommand,
} from "./scenario.ts";

const build = new URL("../../../dist/", import.meta.url);
const [
  { startServer },
  { createAppRouter },
  { createAccount },
  { createSessions },
  { requireAccount },
  { AuthPage },
] = await Promise.all([
  import(new URL("server.ts", build).href) as Promise<typeof import("../../../server.ts")>,
  import(new URL("app/router.ts", build).href) as Promise<typeof import("../../../app/router.ts")>,
  import(new URL("app/auth/accounts.ts", build).href) as Promise<
    typeof import("../../../app/auth/accounts.ts")
  >,
  import(new URL("app/auth/sessions.ts", build).href) as Promise<
    typeof import("../../../app/auth/sessions.ts")
  >,
  import(new URL("app/auth/route-guard.ts", build).href) as Promise<
    typeof import("../../../app/auth/route-guard.ts")
  >,
  import(new URL("app/actions/auth-page.tsx", build).href) as Promise<
    typeof import("../../../app/actions/auth-page.tsx")
  >,
]);

let timestamp = Date.now();
let invitationValid = true;
const now = () => timestamp;

const server = await startServer({
  verifyClient: createTwilioVerifyMock(now),
  databasePath: ":memory:",
  host: "127.0.0.1",
  async createRouter(options) {
    const { db } = options;
    await createAccount(db, {
      verifiedPhoneNumber: returningAccount.phone,
      name: returningAccount.name,
    });
    const router = await createAppRouter({ ...options, now });
    const guard = requireAccount(createSessions(db, { now }));
    router.get(eventPath, {
      middleware: [guard],
      handler({ account, render }) {
        return account.verifiedPhoneNumber === returningAccount.phone
          ? render(<AuthPage heading={`Supper event for ${account.name}`} />)
          : render(<AuthPage heading="You don't have access to this event." />, { status: 403 });
      },
    });
    router.get(invitationPath, {
      middleware: [guard],
      handler({ account, render }) {
        if (!invitationValid) {
          return render(<AuthPage heading="This invitation has expired." />, { status: 403 });
        }
        if (account.verifiedPhoneNumber !== newAccount.phone) {
          return render(<AuthPage heading="This invitation belongs to another guest." />, {
            status: 403,
          });
        }
        return render(<AuthPage heading={`Supper invitation for ${account.name}`} />);
      },
    });
    return router;
  },
});

if (!server.listening) await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string" || !process.send) {
  throw new Error("Run the browser test server through the Playwright fixture");
}

process.once("disconnect", () => process.kill(process.pid, "SIGTERM"));
process.on("message", (command: AppCommand) => {
  if (command === "revokeInvitation") invitationValid = false;
  else timestamp += command.advanceMs;
  process.send?.("updated");
});
process.send(address.port);
