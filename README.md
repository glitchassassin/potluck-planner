# Potluck Planner

## Deployment

Set the three `TWILIO_*` variables from `.env.example` in `.env.production`. Pull and run the container.

```sh
docker pull ghcr.io/glitchassassin/potluck-planner:latest
docker run -d --name potluck-planner --restart unless-stopped \
  --env-file ./.env.production \
  -p 44100:44100 -v potluck-data:/data \
  ghcr.io/glitchassassin/potluck-planner:latest
```

Serve the app over HTTPS and back up the `potluck-data` volume regularly.

If you deploy behind a reverse proxy, set `TRUSTED_PROXY_IPS` to the proxy IP addresses the app sees. Restrict direct access to port `44100` and configure the proxy to remove incoming `Forwarded` and `X-Forwarded-*` headers before setting its own.

## Development

Use Node 24 and npm. Export any configuration overrides in your shell before starting the server. Use the variable names listed in `.env.example`.

```sh
nvm use
npm ci
npm run dev
```

Open http://127.0.0.1:44100 and enter `000000` when prompted for a verification code.

Run type checking, linting, formatting checks, and server tests.

```sh
npm run check
```

Build the app and run the browser and accessibility checks.

```sh
npm run build
npm ci --prefix dist --omit=dev
npx playwright install chromium
npm run test:e2e
```

Run `npm run format` to apply formatting.

Set `DATABASE_PATH=./db/mock.sqlite` when running `npm run db:status`, `npm run db:migrate`, or `npm run db:rollback` against the development database. Add SQL migrations under `db/migrations`.
