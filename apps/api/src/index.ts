import { createPrismaClient, createRepositories } from "@fitcoach/db";
import { createServer } from "./server";
import { createServices } from "./services";

const DEFAULT_PORT = 8787;

/**
 * Composition root (milestone §12): the only place that knows about Prisma.
 * Everything above it depends on repository interfaces; nothing below it
 * knows about HTTP.
 */
export function main(): void {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    process.stderr.write(
      "fitcoach api: DATABASE_URL is required (see .env.example / docs/DATABASE_IMPLEMENTATION.md)\n",
    );
    process.exitCode = 1;
    return;
  }

  const prisma = createPrismaClient({ url: databaseUrl });
  const repositories = createRepositories(prisma);
  const services = createServices(repositories);

  const port = Number(process.env["PORT"] ?? DEFAULT_PORT);
  const server = createServer({ services });

  server.listen(port, () => {
    process.stdout.write(`fitcoach api listening on port ${port}\n`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`fitcoach api: ${signal} received, shutting down\n`);
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
    // Force-exit guard if connections keep the server open.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

if (require.main === module) {
  main();
}
