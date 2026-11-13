#!/usr/bin/env node
import EmbeddedPostgres from "embedded-postgres";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const DEV_DB_DIR = path.join(root, ".devstack", "pg");
const DEV_DB_PORT = 5432;

const pg = new EmbeddedPostgres({
  databaseDir: DEV_DB_DIR,
  port: DEV_DB_PORT,
  user: "postgres",
  password: "postgres",
  persistent: true,
  onLog: (message) => console.log(`[postgres] ${message}`),
  onError: (message) => console.error(`[postgres] ${message}`),
});

async function main() {
  console.log("Starting embedded PostgreSQL...");
  await pg.start();
  await pg.createDatabase("fitcoach").catch(() => {
    // Already created by an earlier run; the directory persists.
  });
  console.log(`Embedded PostgreSQL listening on ${DEV_DB_PORT}, database "fitcoach"`);
  console.log("Press Ctrl+C to stop");

  process.on("SIGINT", async () => {
    console.log("\nStopping PostgreSQL...");
    await pg.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nStopping PostgreSQL...");
    await pg.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Failed to start PostgreSQL:", error);
  process.exit(1);
});