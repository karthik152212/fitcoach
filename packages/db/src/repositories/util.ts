import { toRepositoryError } from "../errors";

/**
 * Run a repository operation and translate any storage failure into the
 * repository error taxonomy, so upper layers never see Prisma error types.
 */
export async function runDb<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw toRepositoryError(error);
  }
}

/** Clamp list limits to a sane, bounded range. */
export function boundedLimit(limit: number | undefined, fallback: number, max = 500): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(Math.floor(limit), max));
}
