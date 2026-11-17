# Potluck Planner

Organize potlucks with your friends. Create an event, share an invitation link, and keep track of what everyone is bringing. Joining is easy: enter your phone number and a code sent by SMS. No password to remember.

## Deployment

Run the app as a single container with one HTTP port and a persistent volume for SQLite data. Configure your host to serve it over HTTPS and back up the data volume regularly.

Set the three `TWILIO_*` variables from `.env.example` in a deployment environment file.

```sh
docker pull ghcr.io/glitchassassin/potluck-planner:latest
docker run -d --name potluck-planner --restart unless-stopped \
  --env-file ./.env.production \
  -p 44100:44100 -v potluck-data:/data \
  ghcr.io/glitchassassin/potluck-planner:latest
```

The app is available on port `44100`, with data stored in `/data`.

Behind a reverse proxy, set `TRUSTED_PROXY_IPS` to the proxy addresses seen by the app so sign-in limits apply to each client. Restrict direct access to the app port and configure the trusted proxy to remove incoming `Forwarded` and `X-Forwarded-*` headers before setting its own.

## Development

Use Node 24 and npm:

```sh
nvm use
npm ci
npm run dev
```

Open http://127.0.0.1:44100 and use code `000000` to verify a supported phone number. The development server uses a Twilio Verify mock and stores accounts in `db/mock.sqlite`. See `.env.example` for other configuration and export overrides in your shell.

Run type checking, linting, formatting checks, and server tests:

```sh
npm run check
```

Run browser and accessibility checks against the production build with the Verify mock and an in-memory database:

```sh
npm run build
npm ci --prefix dist --omit=dev
npx playwright install chromium
npm run test:e2e
```

Use `npm run format` to apply formatting. SQLite migration commands are `npm run db:status`, `npm run db:migrate`, and `npm run db:rollback`. Set `DATABASE_PATH=./db/mock.sqlite` when running those commands against the development database. Add SQL migrations under `db/migrations`.
