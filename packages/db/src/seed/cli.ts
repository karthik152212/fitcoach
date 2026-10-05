import { createPrismaClient } from "../client";
import { seedDatabase } from "./seed";

/**
 * Usage:
 *   DATABASE_URL=postgresql://... node dist/seed/cli.js
 *   node dist/seed/cli.js --url=postgresql://...
 */
async function main(): Promise<void> {
  const urlArg = process.argv.find((arg) => arg.startsWith("--url="));
  const url = urlArg ? urlArg.slice("--url=".length) : process.env["DATABASE_URL"];
  if (!url) {
    process.stderr.write(
      "seed: DATABASE_URL (or --url=) is required.\n" +
        "      See docs/DATABASE_IMPLEMENTATION.md for local setup.\n",
    );
    process.exitCode = 1;
    return;
  }

  const prisma = createPrismaClient({ url });
  try {
    const result = await seedDatabase(prisma);
    process.stdout.write(
      `seed: ${result.equipment} equipment, ${result.muscles} muscles, ` +
        `${result.exercises} exercises, ${result.foods} foods, dev user ${result.devUserId}\n` +
        `      (${result.label})\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
