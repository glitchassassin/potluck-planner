import { resolve } from "node:path";
import { loadMigrations } from "remix/data-table/migrations/node";
import { createSqliteDatabase, type SqliteDatabase } from "remix/data-table/sqlite";

import remixConfig from "../remix.json" with { type: "json" };

const { adapter, migrations } = remixConfig.db;

export function openDatabase(
  filename = process.env[adapter.filename.env] || adapter.filename.default,
): SqliteDatabase {
  return createSqliteDatabase({
    filename: filename === ":memory:" ? filename : resolve(import.meta.dirname, "..", filename),
    foreignKeys: adapter.foreignKeys,
    busyTimeout: adapter.busyTimeout,
  });
}

export async function migrateDatabase(db: SqliteDatabase): Promise<void> {
  const migrationFiles = await loadMigrations(
    resolve(import.meta.dirname, "..", migrations.directory),
  );
  await db.migrate(migrationFiles);
}
