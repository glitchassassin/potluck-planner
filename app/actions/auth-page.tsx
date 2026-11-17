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
