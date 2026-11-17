import type { Handle } from "remix/component";

import { routes } from "../routes.ts";
import { AuthPage, NameField, SubmitButton } from "./auth-page.tsx";

export function ProfilePage(handle: Handle<{ name: string; error?: string }>) {
  return () => {
    const { name, error } = handle.props;
    return (
      <AuthPage heading="Profile">
        <form method="post" action={routes.profile.action.href()} class="auth-form" novalidate>
          <NameField value={name} error={error} />
          <SubmitButton label="Save" />
        </form>
        <a href={routes.home.href()} class="potluck-secondary">
          Back to home
        </a>
      </AuthPage>
    );
  };
}
