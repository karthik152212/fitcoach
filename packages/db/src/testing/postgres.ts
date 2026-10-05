import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Test-only PostgreSQL harness.
 *
 * Integration tests must run against a real PostgreSQL instance. The harness
 * prefers (in order):
 *
 *   1. FITCOACH_TEST_DATABASE_URL — an externally managed test database the
 *      caller already provisioned (CI service container, local dev server).
 *      The harness applies migrations to it, so it must be disposable.
 *   2. embedded-postgres — a real PostgreSQL binary started in a temporary
 *      directory for the duration of the test run.
 *
 * If neither can be produced, the harness throws: integration tests fail
 * loudly rather than silently skipping, because a green suite that never
 * touched the database would be a lie.
 */
export interface TestPostgres {
  /** Connection URL for the migrated test database. */
  readonly url: string;
  /** True when the harness owns an embedded cluster and must stop it. */
  readonly embedded: boolean;
  stop(): Promise<void>;
}

const PSQL_URL_PREFIX = "postgresql://";

function resolveMigrationsSchemaPath(): string {
  // dist/testing/../../prisma/schema.prisma -> packages/db/prisma/schema.prisma
  return path.join(__dirname, "..", "..", "prisma", "schema.prisma");
}

function resolvePrismaCliPath(): string {
  // The prisma package's main entry is its CLI build; resolving the package
  // avoids depending on .bin shims (which differ per platform).
  const prismaPkg = require.resolve("prisma/package.json");
  return path.join(path.dirname(prismaPkg), "build", "index.js");
}

/** Apply prisma/migrations to the given database via `prisma migrate deploy`. */
export function migrateDeploy(databaseUrl: string): void {
  const cli = resolvePrismaCliPath();
  const schema = resolveMigrationsSchemaPath();
  const result = spawnSync(process.execPath, [cli, "migrate", "deploy", "--schema", schema], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    throw new Error(`prisma migrate deploy failed (exit ${result.status}):\n${output}`);
  }
}

async function freePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("failed to bind a test port")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

/** Start (and migrate) a disposable test database. */
export async function startTestPostgres(): Promise<TestPostgres> {
  const externalUrl = process.env["FITCOACH_TEST_DATABASE_URL"];
  if (externalUrl && externalUrl.startsWith(PSQL_URL_PREFIX)) {
    migrateDeploy(externalUrl);
    return {
      url: externalUrl,
      embedded: false,
      stop: async () => {
        /* externally managed */
      },
    };
  }

  // Lazy require: embedded-postgres is a devDependency, and the published
  // runtime path of this package must not depend on it.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const module = require("embedded-postgres") as { default: EmbeddedPostgresCtor };
  const EmbeddedPostgres = module.default;

  const port = await freePort();
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "fitcoach-pg-"));
  const cluster = new EmbeddedPostgres({
    databaseDir,
    port,
    user: "postgres",
    password: "postgres",
    authMethod: "password",
    persistent: false,
    // The cluster must be UTF-8: on Windows, initdb inherits the ANSI locale
    // (often WIN1252), which rejects any non-ASCII value a client sends —
    // accents, emoji, typographic minus — with encoding 22P05.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {
      /* keep test output clean */
    },
    onError: (message: unknown) => {
      process.stderr.write(`[embedded-postgres] ${String(message)}\n`);
    },
  });

  try {
    await cluster.initialise();
    await cluster.start();
  } catch (error) {
    fs.rmSync(databaseDir, { recursive: true, force: true });
    throw new Error(
      `failed to start embedded PostgreSQL: ${String(error)}. ` +
        "Install the platform binary (devDependency embedded-postgres) or set " +
        "FITCOACH_TEST_DATABASE_URL to an external disposable database.",
    );
  }

  const url = `${PSQL_URL_PREFIX}postgres:postgres@127.0.0.1:${port}/postgres`;
  migrateDeploy(url);

  return {
    url,
    embedded: true,
    stop: async () => {
      try {
        await cluster.stop();
      } finally {
        fs.rmSync(databaseDir, { recursive: true, force: true });
      }
    },
  };
}

interface EmbeddedPostgresCtor {
  new (options: Record<string, unknown>): {
    initialise(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
  };
}
