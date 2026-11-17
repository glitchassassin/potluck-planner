import type { Handle } from "remix/component";

import { signInHref } from "../auth/route-guard.ts";
import { routes } from "../routes.ts";
import { AuthPage, FieldError, NameField, SubmitButton } from "./auth-page.tsx";

interface PhoneProps {
  returnPath: string;
  value?: string;
  error?: string;
}

export const maxPhoneLength = 40;

export function PhonePage(handle: Handle<PhoneProps>) {
  return () => {
    const { returnPath, value, error } = handle.props;
    return (
      <AuthPage heading="Sign in or sign up">
        <form method="post" action={routes.signIn.phone.action.href()} class="auth-form">
          <input type="hidden" name="returnTo" value={returnPath} />
          <div class="potluck-field">
            <label for="phone" class="potluck-label">
              Phone number
            </label>
            <input
              class="potluck-input"
              id="phone"
              name="phone"
              type="tel"
              autocomplete="tel"
              required
              maxLength={maxPhoneLength}
              value={value}
              aria-invalid={error ? "true" : undefined}
              aria-describedby={error ? "phone-error" : undefined}
            />
            <FieldError id="phone-error" error={error} />
          </div>
          <SubmitButton label="Send code" />
        </form>
      </AuthPage>
    );
  };
}

interface CodeProps {
  destination: string;
  returnPath: string;
  error?: string;
  resendError?: string;
  resent?: boolean;
}

export function CodePage(handle: Handle<CodeProps>) {
  return () => {
    const { destination, returnPath, error, resendError, resent } = handle.props;
    return (
      <AuthPage heading="Enter your code">
        <p>
          {resent ? "We sent another code to" : "We sent a code to"} {destination}.
        </p>
        <form method="post" action={routes.signIn.code.action.href()} class="auth-form">
          <div class="potluck-field">
            <label for="code" class="potluck-label">
              Verification code
            </label>
            <input
              class="potluck-input"
              id="code"
              name="code"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              required
              maxLength={10}
              aria-invalid={error ? "true" : undefined}
              aria-describedby={error ? "code-error" : undefined}
            />
            <FieldError id="code-error" error={error} />
          </div>
          <SubmitButton label="Verify code" />
        </form>
        <div class="auth-options">
          <form method="post" action={routes.signIn.resend.href()}>
            <button
              type="submit"
              class="potluck-secondary"
              aria-describedby={resendError ? "resend-error" : undefined}
            >
              Resend code
            </button>
          </form>
          <a href={signInHref(returnPath)} class="potluck-secondary">
            Switch phone number
          </a>
        </div>
        <FieldError id="resend-error" error={resendError} />
      </AuthPage>
    );
  };
}

export function NamePage(handle: Handle<{ error?: string }>) {
  return () => {
    const { error } = handle.props;
    return (
      <AuthPage heading="What's your name?">
        <form method="post" action={routes.signIn.name.action.href()} class="auth-form">
          <NameField error={error} />
          <SubmitButton label="Sign Up" />
        </form>
      </AuthPage>
    );
  };
}
