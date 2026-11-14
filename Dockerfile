FROM node:24.15.0-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24.15.0-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=44100 DATABASE_PATH=/data/app.sqlite
WORKDIR /app
COPY --from=build --chown=node:node /app/dist/ ./
RUN npm ci --omit=dev && npm cache clean --force && mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 44100
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["npm", "start"]
