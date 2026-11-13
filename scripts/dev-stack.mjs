#!/usr/bin/env node
/**
 * Local development stack.
 *
 * `npm run dev:web` only serves the UI: Vite proxies `/v0` to the API on
 * 127.0.0.1:8787, and if nothing is listening there every request fails with
 * `ECONNREFUSED` (the onboarding equipment screen is the first casualty).
 *
 * This script brings up what the UI needs:
 *
 *   1. PostgreSQL — the one named by DATABASE_URL when it is reachable,
 *      otherwise an embedded cluster under `.devstack/pg` (same binary the
 *      database tests use, so no system install is required).
 *   2. Migrations + the idempotent seed, so the catalogue is populated.
 *   3. The API on port 8787 (`PORT` overrides).
 *   4. Optionally the Vite dev server (`--web`), proxying `/v0` to step 3.
 *
 * Usage:
 *   node scripts/dev-stack.mjs          # database + API
 *   node scripts/dev-stack.mjs --web    # database + API + UI
 *   node scripts/dev-stack.mjs --no-build
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const withWeb = args.has("--web");
const skipBuild = args.has("--no-build");

const API_PORT = Number(process.env["PORT"] ?? 8787);
const DEV_DB_PORT = Number(process.env["FITCOACH_DEV_DB_PORT"] ?? 5432);
const DEV_DB_DIR = path.join(root, ".devstack", "pg");

function log(message) {
  process.stdout.write(`[dev-stack] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[dev-stack] ${message}\n`);
  process.exit(1);
}

/** Minimal .env reader: enough for `KEY=value`, quotes and comments. */
function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    env[key] = value.replace(/^["']|["']$/g, "");
  }
  return env;
}

function parseDatabaseUrl(url) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: Number(parsed.port || 5432),
      database: parsed.pathname.replace(/^\//, "") || "postgres",
    };
  } catch {
    return null;
  }
}

function canConnect(host, port, timeoutMs = 750) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

/**
 * Resolve npm to a plain `node <npm-cli.js>` call where possible.
 *
 * `npm` is a `.cmd` shim on Windows, so spawning it normally needs a shell —
 * and Node deprecates passing an argument array with `shell: true`. Running the
 * CLI script through the current node binary avoids both the warning and any
 * quoting trouble with installation paths that contain spaces.
 */
function npmInvocation(npmArgs) {
  const candidates = [
    process.env["npm_execpath"],
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const cli = candidates.find((candidate) => candidate && candidate.endsWith(".js") && fs.existsSync(candidate));
  if (cli) return { command: process.execPath, args: [cli, ...npmArgs], shell: false };
  return { command: "npm", args: npmArgs, shell: process.platform === "win32" };
}

function run(command, commandArgs, env, shell = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: root,
      env,
      stdio: "inherit",
      shell,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${commandArgs.join(" ")} exited with ${code}`));
    });
  });
}

function runNode(script, scriptArgs, env) {
  return run(process.execPath, [script, ...scriptArgs], env);
}

function npmRun(script, extra, env) {
  const npmArgs = ["run", script];
  if (extra && extra.length > 0) npmArgs.push("--", ...extra);
  const { command, args: commandArgs, shell } = npmInvocation(npmArgs);
  return run(command, commandArgs, env, shell);
}

async function main() {
  const fileEnv = readEnvFile(path.join(root, ".env"));
  const env = { ...fileEnv, ...process.env };
  let databaseUrl = env["DATABASE_URL"] ?? "";
  let postgres = null;

  const declared = databaseUrl ? parseDatabaseUrl(databaseUrl) : null;
  const declaredUp = declared ? await canConnect(declared.host, declared.port) : false;

  if (declaredUp) {
    log(`using PostgreSQL at ${declared.host}:${declared.port}/${declared.database}`);
  } else {
    if (declared && !["127.0.0.1", "localhost", "::1"].includes(declared.host)) {
      fail(
        `DATABASE_URL points at ${declared.host}:${declared.port}, which is not reachable. ` +
          "Start that database or unset DATABASE_URL to use the embedded dev cluster.",
      );
    }
    if (declared) {
      log(`nothing listening on ${declared.host}:${declared.port}; starting the embedded cluster instead`);
    }

    const port = (await portIsFree(DEV_DB_PORT)) ? DEV_DB_PORT : DEV_DB_PORT + 1;
    if (port !== DEV_DB_PORT) log(`port ${DEV_DB_PORT} is busy; embedded PostgreSQL will use ${port}`);

    postgres = new EmbeddedPostgres({
      databaseDir: DEV_DB_DIR,
      port,
      user: "postgres",
      password: "postgres",
      persistent: true,
      onLog: (message) => log(`postgres: ${message}`),
      onError: (message) => process.stderr.write(`[dev-stack] postgres: ${String(message)}\n`),
    });

    if (!fs.existsSync(path.join(DEV_DB_DIR, "PG_VERSION"))) {
      log(`initialising embedded PostgreSQL in .devstack/pg`);
      await postgres.initialise();
    }
    await postgres.start();
    await postgres.createDatabase("fitcoach").catch(() => {
      // Already created by an earlier run; the directory persists.
    });
    databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/fitcoach?schema=public`;
    log(`embedded PostgreSQL listening on ${port}, database "fitcoach"`);
  }

  env["DATABASE_URL"] = databaseUrl;
  env["PORT"] = String(API_PORT);
  env["NODE_ENV"] = env["NODE_ENV"] ?? "development";

  if (!skipBuild) {
    log("building the workspace (tsc -b)");
    await npmRun("build", [], env);
  }

  log("applying migrations");
  await runNode(
    path.join(root, "node_modules", "prisma", "build", "index.js"),
    ["migrate", "deploy", "--schema", path.join("packages", "db", "prisma", "schema.prisma")],
    env,
  );

  log("seeding the exercise catalogue");
  await runNode(path.join("packages", "db", "dist", "seed", "cli.js"), [], env);

  const children = [];
  let stopping = false;

  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    log(`${signal} received, shutting down`);
    for (const child of children) {
      if (child.exitCode === null) {
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
          child.kill("SIGTERM");
        }
      }
    }
    if (postgres) await postgres.stop().catch(() => undefined);
    process.exit(0);
  };

  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));

  const start = (label, command, commandArgs, shell = false) => {
    const child = spawn(command, commandArgs, { cwd: root, env, stdio: "inherit", shell });
    child.on("exit", (code) => {
      if (!stopping) {
        log(`${label} exited (${code}); stopping the stack`);
        void stop(`${label} exit`);
      }
    });
    children.push(child);
    return child;
  };

  log(`starting the API on port ${API_PORT}`);
  start("api", process.execPath, [path.join("apps", "api", "dist", "index.js")]);

  if (withWeb) {
    log("starting the Vite dev server (http://localhost:5173)");
    const web = npmInvocation(["run", "dev", "-w", "@fitcoach/web"]);
    start("web", web.command, web.args, web.shell);
  } else {
    log("UI not started; run `npm run dev:web` in another terminal or use `npm run dev`");
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
