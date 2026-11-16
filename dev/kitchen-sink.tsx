import { css } from "remix/component";
import { createAction } from "remix/router";
import { get } from "remix/routes";

import { Document } from "../app/actions/document.tsx";
import { designSystem, palette } from "../app/ui/design-system.ts";

const backgrounds = [
  { theme: "Default", file: "default", title: "Sunday potluck" },
  { theme: "Birthday", file: "birthday", title: "Birthday potluck" },
  { theme: "Thanksgiving / Fall", file: "thanksgiving-fall", title: "Thanksgiving potluck" },
  { theme: "Christmas / Winter", file: "christmas-winter", title: "Christmas potluck" },
  { theme: "Picnic / Summer", file: "picnic-summer", title: "Summer picnic" },
];

const appearances = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const kitchenSinkStyles = css({
  minBlockSize: "100vh",
  "&:has(#scheme-light:checked)": { colorScheme: "light" },
  "&:has(#scheme-dark:checked)": { colorScheme: "dark" },
  "& .kitchen-main": {
    display: "grid",
    gap: 24,
    maxInlineSize: 1120,
    marginInline: "auto",
    padding: "24px 16px 40px",
  },
  "& .kitchen-header": {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "end",
    gap: 16,
  },
  "& .kitchen-appearance": { minInlineSize: 0, margin: 0, padding: 0, border: 0 },
  "& .kitchen-appearance legend": { padding: 0, marginBlockEnd: 4 },
  "& .kitchen-options": { display: "flex", flexWrap: "wrap", gap: 4 },
  "& .kitchen-options label": {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    minBlockSize: "var(--potluck-tap-size)",
    padding: "4px 8px",
    cursor: "pointer",
  },
  "& .kitchen-options input": { margin: 0, accentColor: "var(--potluck-action)" },
  "& .kitchen-section": { display: "grid", alignContent: "start", gap: 16, minInlineSize: 0 },
  "& .kitchen-gallery, & .kitchen-pair": { display: "grid", gap: 16 },
  "& .kitchen-gallery": {
    alignItems: "start",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
  },
  "& .kitchen-pair": { gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))" },
  "& .kitchen-gallery figcaption": { paddingBlockStart: 8 },
  "& .kitchen-stack": { display: "grid", gap: 8 },
  "& .kitchen-specimen .potluck-display": { marginBlock: "4px 8px" },
  "& .kitchen-actions": { display: "grid", gap: 8, maxInlineSize: "var(--potluck-content-width)" },
  "& .kitchen-palette": {
    width: "100%",
    borderCollapse: "collapse",
    tableLayout: "fixed",
    textAlign: "start",
  },
  "& .kitchen-palette :is(th, td)": {
    padding: "8px 4px",
    borderBlockEnd: "1px solid var(--potluck-divider)",
    textAlign: "start",
    overflowWrap: "anywhere",
  },
  "& .kitchen-palette code": { fontSize: "0.8125rem" },
  "& .kitchen-swatch": {
    display: "inline-block",
    inlineSize: 16,
    blockSize: 16,
    marginInlineEnd: 6,
    verticalAlign: "middle",
    border: "1px solid var(--potluck-field-border)",
    borderRadius: 2,
  },
});

export const kitchenSinkRoute = get("/dev/kitchen-sink");

export const kitchenSink = createAction(kitchenSinkRoute, function (context) {
  return context.render(<KitchenSink />);
});

function KitchenSink() {
  return () => (
    <Document
      title="Design system | Potluck Planner"
      head={
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Instrument+Sans:wght@400..700&display=swap"
        />
      }
    >
      <div mix={[designSystem, kitchenSinkStyles]}>
        <header class="potluck-wordmark">Potluck Planner</header>
        <main class="kitchen-main">
          <div class="kitchen-header">
            <h1 class="potluck-display">Design system</h1>
            <fieldset class="kitchen-appearance">
              <legend class="potluck-label">Appearance</legend>
              <div class="kitchen-options">
                {appearances.map(({ id, label }) => (
                  <label key={id} class="potluck-meta">
                    <input
                      id={`scheme-${id}`}
                      type="radio"
                      name="appearance"
                      defaultChecked={id === "system"}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <section class="kitchen-section potluck-section-card" aria-labelledby="photo-headers">
            <h2 class="potluck-heading" id="photo-headers">
              Photo headers
            </h2>
            <div class="kitchen-gallery">
              {backgrounds.map(({ theme, file, title }) => (
                <figure key={file}>
                  <div class="potluck-photo-header">
                    <img src={`/event-backgrounds/${file}.webp`} alt="" width={1160} height={464} />
                    <p class="potluck-eyebrow">You’re invited</p>
                    <h3 class="potluck-display">{title}</h3>
                    <p class="potluck-meta">4:00 p.m. ET</p>
                  </div>
                  <figcaption class="potluck-meta">{theme}</figcaption>
                </figure>
              ))}
            </div>
          </section>

          <div class="kitchen-pair">
            <section class="kitchen-section potluck-section-card" aria-labelledby="typography">
              <h2 class="potluck-heading" id="typography">
                Typography
              </h2>
              <div class="kitchen-specimen kitchen-stack">
                <p class="potluck-eyebrow">You’re invited</p>
                <p class="potluck-display">Sunday potluck</p>
                <h3 class="potluck-heading">What to bring</h3>
                <p>Bring a favorite side, dessert, or drink.</p>
                <p class="potluck-meta">Sunday, November 22 at 4:00 p.m.</p>
                <p class="potluck-label">Event name</p>
                <p class="potluck-help">Use a name guests will recognize.</p>
              </div>
            </section>

            <section class="kitchen-section potluck-section-card" aria-labelledby="controls">
              <h2 class="potluck-heading" id="controls">
                Buttons and fields
              </h2>
              <div class="kitchen-actions">
                <div class="potluck-field">
                  <label class="potluck-label" htmlFor="event-name">
                    Event name
                  </label>
                  <input
                    class="potluck-input"
                    id="event-name"
                    defaultValue="Sunday potluck"
                    aria-describedby="event-help"
                  />
                  <p class="potluck-help" id="event-help">
                    Use a name guests will recognize.
                  </p>
                </div>
                <div class="potluck-field">
                  <label class="potluck-label" htmlFor="event-error">
                    Event name with an error
                  </label>
                  <input
                    class="potluck-input"
                    id="event-error"
                    aria-invalid="true"
                    aria-describedby="event-error-text"
                  />
                  <p class="potluck-error" id="event-error-text">
                    Enter an event name.
                  </p>
                </div>
                <button
                  type="button"
                  class="potluck-button potluck-button--full"
                  command="show-modal"
                  commandfor="remove-contribution"
                >
                  Preview confirmation
                </button>
                <button type="button" class="potluck-button potluck-button--full" disabled>
                  Save changes
                </button>
                <a class="potluck-secondary" href="#feedback">
                  View feedback
                </a>
              </div>
            </section>
          </div>

          <div class="kitchen-pair">
            <section class="kitchen-section potluck-section-card" aria-labelledby="list-rows">
              <h2 class="potluck-heading" id="list-rows">
                List rows
              </h2>
              <ul class="potluck-list">
                <li class="potluck-row">
                  <div>
                    <p class="potluck-label">Sourdough bread</p>
                    <p class="potluck-help">Cora Lee</p>
                  </div>
                  <button
                    type="button"
                    class="potluck-secondary"
                    command="show-modal"
                    commandfor="remove-contribution"
                    aria-label="Remove sourdough bread"
                  >
                    Remove
                  </button>
                </li>
                <li class="potluck-row">
                  <div>
                    <p class="potluck-label">Apple crisp</p>
                    <p class="potluck-help">Sam Rivera</p>
                  </div>
                </li>
              </ul>
            </section>

            <section class="kitchen-section potluck-section-card" aria-labelledby="feedback">
              <h2 class="potluck-heading" id="feedback">
                Feedback and confirmation
              </h2>
              <div class="kitchen-stack">
                <p class="potluck-success">
                  <span aria-hidden="true">✓</span> Changes saved.
                </p>
                <p class="potluck-error">Couldn’t save the changes. Try again.</p>
              </div>
              <dialog
                class="potluck-dialog"
                id="remove-contribution"
                aria-labelledby="remove-title"
                aria-describedby="remove-details"
              >
                <h3 class="potluck-heading" id="remove-title">
                  Remove sourdough bread?
                </h3>
                <p id="remove-details">This removes the contribution from the potluck.</p>
                <form class="potluck-dialog-actions" method="dialog">
                  <button class="potluck-secondary" value="cancel" autofocus>
                    Cancel
                  </button>
                  <button class="potluck-button" value="remove">
                    Remove contribution
                  </button>
                </form>
              </dialog>
            </section>
          </div>

          <section class="kitchen-section potluck-section-card" aria-labelledby="palette">
            <h2 class="potluck-heading" id="palette">
              Palette
            </h2>
            <table class="kitchen-palette" aria-labelledby="palette">
              <thead>
                <tr>
                  <th scope="col">Role</th>
                  <th scope="col">Light</th>
                  <th scope="col">Dark</th>
                </tr>
              </thead>
              <tbody>
                {palette.map(({ name, token, light, dark }) => (
                  <tr key={token}>
                    <th scope="row" class="potluck-meta">
                      {name}
                    </th>
                    <td>
                      <span
                        class="kitchen-swatch"
                        style={{ backgroundColor: light }}
                        aria-hidden="true"
                      />
                      <code>{light}</code>
                    </td>
                    <td>
                      <span
                        class="kitchen-swatch"
                        style={{ backgroundColor: dark }}
                        aria-hidden="true"
                      />
                      <code>{dark}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </main>
      </div>
    </Document>
  );
}
