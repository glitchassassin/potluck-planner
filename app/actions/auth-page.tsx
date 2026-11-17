import { css, type Handle, type RemixNode } from "remix/component";

import { designSystem, fontStylesheet } from "../ui/design-system.ts";
import { Document } from "./document.tsx";

const pageStyles = css({
  minBlockSize: "100vh",
  "& .auth-main": {
    maxInlineSize: "calc(var(--potluck-content-width) + 32px)",
    marginInline: "auto",
    padding: "clamp(24px, 8vw, 64px) 16px",
  },
  "& .auth-card, & .auth-form": { display: "grid", gap: 16 },
  "& .auth-card h1": { overflowWrap: "anywhere" },
  "& .auth-options": {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: "0 16px",
  },
});

interface PageProps {
  heading: string;
  children?: RemixNode;
}

export function AuthPage(handle: Handle<PageProps>) {
  return () => {
    const { heading, children } = handle.props;
    return (
      <Document title="Potluck Planner" head={<link rel="stylesheet" href={fontStylesheet} />}>
        <div mix={[designSystem, pageStyles]}>
          <header class="potluck-wordmark">Potluck Planner</header>
          <main class="auth-main">
            <section class="auth-card potluck-section-card" aria-labelledby="page-heading">
              <h1 class="potluck-display" id="page-heading">
                {heading}
              </h1>
              {children}
            </section>
          </main>
        </div>
      </Document>
    );
  };
}

export function NameField(handle: Handle<{ value?: string; error?: string }>) {
  return () => {
    const { value, error } = handle.props;
    return (
      <div class="potluck-field">
        <label for="name" class="potluck-label">
          Name
        </label>
        <input
          class="potluck-input"
          id="name"
          name="name"
          type="text"
          autocomplete="name"
          required
          value={value}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? "name-error" : undefined}
        />
        <FieldError id="name-error" error={error} />
      </div>
    );
  };
}

export function FieldError(handle: Handle<{ id: string; error?: string }>) {
  return () => {
    const { id, error } = handle.props;
    return error ? (
      <p id={id} class="potluck-error" role="alert">
        {error}
      </p>
    ) : null;
  };
}

export function SubmitButton(handle: Handle<{ label: string }>) {
  return () => (
    <button type="submit" class="potluck-button potluck-button--full">
      {handle.props.label}
    </button>
  );
}
