# Potluck Planner

Organize potlucks with your friends. Create an event, share an invitation link, and keep track of what everyone is bringing. Joining is easy: enter your phone number and a code sent by SMS. No password to remember.

## Deployment

Run the app as a single container with one HTTP port and a persistent volume for SQLite data. Configure your host to serve it over HTTPS and back up the data volume regularly.

```sh
docker pull ghcr.io/glitchassassin/potluck-planner:latest
docker run -d --name potluck-planner --restart unless-stopped \
  -p 44100:44100 -v potluck-data:/data \
  ghcr.io/glitchassassin/potluck-planner:latest
```

The app is available on port `44100`, with data stored in `/data`.

The server applies pending SQLite migrations on startup. Set `ADMIN_PHONE_ALLOWLIST` to a comma-separated list of verified phone numbers that should have Admin access. Blank and invalid entries are ignored. Leaving the variable empty grants no Admin access.

## Development

Use Node 24 and npm:

```sh
nvm use
npm ci
npm run dev
```

Open http://localhost:44100. See `.env.example` for configuration; export overrides in your shell.

Run type checking, linting, formatting checks, and server tests:

```sh
npm run check
```

Run browser and accessibility checks against the production build:

```sh
npm run build
npm ci --prefix dist --omit=dev
npx playwright install chromium
npm run test:e2e
```

Use `npm run format` to apply formatting. SQLite migration commands are `npm run db:status`, `npm run db:migrate`, and `npm run db:rollback`; add SQL migrations under `db/migrations` as the schema develops.
