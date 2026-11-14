import { cp, mkdir, rm } from "node:fs/promises";

// Remix runs TS/TSX directly and serves transformed assets on demand.
// Package the production source tree without tests or development data.
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
for (const path of [
  "app",
  "public",
  "db",
  "server.ts",
  "tsconfig.json",
  "remix.json",
  "package.json",
  "package-lock.json",
]) {
  await cp(path, `dist/${path}`, {
    recursive: true,
    filter: (source) => !source.includes(".test.") && !/\.sqlite(?:-|$)/.test(source),
  });
}
