/**
 * Presentation helpers for domain strings.
 *
 * The engine speaks in slugs (`home_no_equipment`, `biceps_brachii`,
 * `lean_recomposition`). The UI must not show those raw to the user, and it
 * must not invent different wording either — it renders the engine's own
 * words with the separators spelled out.
 */

/** `lean_recomposition` → `lean recomposition`. */
export function humanise(value: string): string {
  return value.replaceAll("_", " ").trim();
}

/** `bodybuilding` → `Bodybuilding`; `aesthetics_v_taper` → `Aesthetics v taper`. */
export function sentence(value: string): string {
  const text = humanise(value);
  return text.length > 0 ? text[0]!.toUpperCase() + text.slice(1) : text;
}

/** Free text that may contain slugs: `horizontal_pull cannot…` → `horizontal pull cannot…`. */
export function humaniseProse(value: string): string {
  return value.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, (match) => match.replaceAll("_", " "));
}

/** Format a number with at most 1 decimal place, trimming trailing zeros. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value % 1 === 0 ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}
