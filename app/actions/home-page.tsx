import type { Handle } from "remix/component";

import { routes } from "../routes.ts";
import { AuthPage } from "./auth-page.tsx";

export function HomePage(handle: Handle<{ name: string }>) {
  return () => (
    <AuthPage heading={`Welcome, ${handle.props.name}`}>
      <div class="auth-options">
        <a href={routes.profile.index.href()} class="potluck-secondary">
          Profile
        </a>
        <form method="post" action={routes.signIn.logout.href()}>
          <button type="submit" class="potluck-secondary">
            Log out
          </button>
        </form>
      </div>
    </AuthPage>
  );
}
