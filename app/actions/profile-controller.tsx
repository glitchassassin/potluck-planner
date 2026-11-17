import type { Database } from "remix/data-table";
import { createController } from "remix/router";

import { updateAccountName, validateAccountName } from "../auth/accounts.ts";
import { authRedirect, requireAccount } from "../auth/route-guard.ts";
import type { createSessions } from "../auth/sessions.ts";
import { routes } from "../routes.ts";
import { ProfilePage } from "./profile-page.tsx";

export function createProfileController(
  db: Database<"sqlite">,
  sessions: ReturnType<typeof createSessions>,
) {
  return createController(routes.profile, {
    middleware: [requireAccount(sessions)],
    actions: {
      index(context) {
        return context.render(<ProfilePage name={context.account.name} />);
      },
      async action(context) {
        const { name, error } = validateAccountName(context.formData.get("name"));
        if (error) {
          return context.render(<ProfilePage name={name} error={error} />, { status: 400 });
        }
        await updateAccountName(db, context.account.id, name);
        return authRedirect(routes.profile.index.href());
      },
    },
  });
}
