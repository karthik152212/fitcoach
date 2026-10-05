/**
 * Thrown by module functions that are declared but not implemented yet.
 * Makes incomplete state explicit instead of silently returning wrong results.
 */
export class NotImplementedError extends Error {
  constructor(functionLabel: string) {
    super(`nutrition: ${functionLabel} is not implemented yet`);
    this.name = "NotImplementedError";
  }
}
