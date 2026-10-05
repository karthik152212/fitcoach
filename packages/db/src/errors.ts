/**
 * Persistence error taxonomy.
 *
 * Repositories translate Prisma/PostgreSQL failures into these errors so the
 * API layer never sees — and never leaks — storage implementation details
 * (milestone §12: "Do not expose database implementation details").
 */

export type RepositoryErrorKind =
  | "not_found"
  | "conflict"
  | "validation"
  | "immutable"
  | "internal";

export class RepositoryError extends Error {
  readonly kind: RepositoryErrorKind;

  constructor(kind: RepositoryErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RepositoryError";
    this.kind = kind;
  }
}

export class NotFoundError extends RepositoryError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("not_found", message, options);
    this.name = "NotFoundError";
  }
}

/** Unique constraint, idempotency-key or state conflicts. */
export class ConflictError extends RepositoryError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("conflict", message, options);
    this.name = "ConflictError";
  }
}

/** Input that violates a database/domain constraint (CHECK, FK, range). */
export class ConstraintValidationError extends RepositoryError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("validation", message, options);
    this.name = "ConstraintValidationError";
  }
}

/** Attempt to rewrite an immutable historical record. */
export class ImmutableRecordError extends RepositoryError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("immutable", message, options);
    this.name = "ImmutableRecordError";
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Translate an unknown failure (almost always a Prisma error) into the
 * repository taxonomy. Prisma error codes handled:
 *   P2002 unique constraint → conflict
 *   P2003 foreign key      → validation
 *   P2004 check constraint → validation (append-only triggers raise 23514)
 *   P2005/P2006 field      → validation
 *   P2014 required relation→ validation
 *   P2025 missing record   → not_found
 *   P2021/P2022 missing table/column → internal
 */
export function toRepositoryError(error: unknown): RepositoryError {
  if (error instanceof RepositoryError) return error;

  const message = errorMessage(error);
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";

  // Append-only / lifecycle / frozen-row triggers raise ERRCODE 23514, which
  // Prisma surfaces with the trigger's message. Phrases mirror the RAISE
  // texts in prisma/migrations/0001_init/migration.sql.
  if (/append-only|content is frozen|lifecycle-column|must record|\bis frozen\b/.test(message)) {
    return new ImmutableRecordError(message, { cause: error });
  }

  switch (code) {
    case "P2002":
      return new ConflictError("unique constraint violated", { cause: error });
    case "P2003":
      return new ConstraintValidationError("referenced record missing or not deletable", {
        cause: error,
      });
    case "P2004":
      return new ConstraintValidationError("database constraint violated", { cause: error });
    case "P2005":
    case "P2006":
    case "P2014":
      return new ConstraintValidationError("invalid field value", { cause: error });
    case "P2025":
      return new NotFoundError("record not found", { cause: error });
    default:
      return new RepositoryError("internal", `persistence failure: ${message}`, { cause: error });
  }
}
