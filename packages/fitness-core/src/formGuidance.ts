import type { FormGuidanceStep, FormGuidanceStepKey } from "@fitcoach/domain";
import { FORM_GUIDANCE_STEP_KEYS, REQUIRED_FORM_GUIDANCE_KEYS } from "@fitcoach/domain";

/**
 * Form guidance utilities (Phase 2, §24/§25).
 *
 * Guidance is stored per structured slot, never as one paragraph, precisely so
 * a future UI can render it several ways from one source of truth:
 *
 *   * quick instructions  → `quickInstructions` (setup, grip, start, path)
 *   * numbered steps      → `orderedSteps` (every slot, in canonical order)
 *   * video captions      → `videoCaptions` (the slots a 10–30 s clip shows)
 *   * searchable guidance → the slots themselves, already keyed
 *   * coaching cues       → `coachingCues`
 *
 * Everything here is derived from stored structured data. AI may later explain
 * or translate these instructions; it must never supply a grip width, a path, a
 * range of motion or a safety note, because those come from here and only from
 * reviewed content.
 */

export interface FormGuidanceValidation {
  valid: boolean;
  missingRequiredKeys: FormGuidanceStepKey[];
  unknownKeys: string[];
  /** Slots present but out of the canonical order, or with duplicate keys. */
  duplicateKeys: string[];
  notes: string[];
}

/** Slots a short demonstration clip is expected to show, in caption order. */
export const VIDEO_CAPTION_KEYS: readonly FormGuidanceStepKey[] = [
  "setup",
  "grip",
  "start_position",
  "movement_path",
  "range_of_motion",
  "breathing",
  "common_mistakes",
] as const;

/** Slots that make a compact "how to do this" card. */
export const QUICK_INSTRUCTION_KEYS: readonly FormGuidanceStepKey[] = [
  "setup",
  "body_position",
  "grip",
  "start_position",
  "movement_path",
  "range_of_motion",
] as const;

export function validateFormGuidance(steps: readonly FormGuidanceStep[]): FormGuidanceValidation {
  const seen = new Set<string>();
  const duplicateKeys: string[] = [];
  for (const step of steps) {
    if (seen.has(step.key)) duplicateKeys.push(step.key);
    seen.add(step.key);
  }

  const known = new Set<string>(FORM_GUIDANCE_STEP_KEYS);
  const unknownKeys = [...seen].filter((key) => !known.has(key)).sort();

  const missingRequiredKeys = REQUIRED_FORM_GUIDANCE_KEYS.filter((key) => !seen.has(key));
  const notes: string[] = [];
  if (steps.length === 0) {
    notes.push("This exercise variation has no form guidance yet; it must not be published as instructed content.");
  }
  if (missingRequiredKeys.length > 0) {
    notes.push(`Missing required guidance: ${missingRequiredKeys.join(", ")}.`);
  }
  const order = FORM_GUIDANCE_STEP_KEYS as readonly string[];
  const positions = steps.map((step) => order.indexOf(step.key));
  if (positions.some((position, index) => index > 0 && position < (positions[index - 1] ?? 0))) {
    notes.push("Guidance is not stored in the canonical slot order.");
  }

  return {
    valid: missingRequiredKeys.length === 0 && duplicateKeys.length === 0 && unknownKeys.length === 0,
    missingRequiredKeys: [...missingRequiredKeys],
    unknownKeys,
    duplicateKeys: [...duplicateKeys].sort(),
    notes,
  };
}

function pick(steps: readonly FormGuidanceStep[], keys: readonly FormGuidanceStepKey[]): FormGuidanceStep[] {
  const byKey = new Map(steps.map((step) => [step.key, step]));
  return keys
    .map((key) => byKey.get(key))
    .filter((step): step is FormGuidanceStep => step !== undefined);
}

/** Every slot in canonical order — what a numbered step list renders. */
export function orderedSteps(steps: readonly FormGuidanceStep[]): FormGuidanceStep[] {
  const byKey = new Map(steps.map((step) => [step.key, step]));
  return FORM_GUIDANCE_STEP_KEYS.filter((key) => byKey.has(key)).map((key) => byKey.get(key)!);
}

/** Compact "how to do this" lines. */
export function quickInstructions(steps: readonly FormGuidanceStep[]): string[] {
  return pick(steps, QUICK_INSTRUCTION_KEYS).map((step) => `${step.heading}: ${step.body}`);
}

/**
 * Deterministic caption track for a short instructional clip. Each caption is
 * derived from a stored slot, so a caption can never drift from the written
 * guidance; timing is left to the renderer.
 */
export function videoCaptions(steps: readonly FormGuidanceStep[]): Array<{
  key: FormGuidanceStepKey;
  caption: string;
}> {
  return pick(steps, VIDEO_CAPTION_KEYS).map((step) => ({ key: step.key, caption: step.body }));
}

export function coachingCues(steps: readonly FormGuidanceStep[]): string[] {
  const step = steps.find((item) => item.key === "coaching_cues");
  if (!step) return [];
  return step.body
    .split(" · ")
    .map((cue) => cue.trim())
    .filter((cue) => cue.length > 0);
}

export function commonMistakes(steps: readonly FormGuidanceStep[]): string {
  return steps.find((item) => item.key === "common_mistakes")?.body ?? "";
}

export function safetyNotes(steps: readonly FormGuidanceStep[]): string | undefined {
  return steps.find((item) => item.key === "safety_notes")?.body;
}

export function intendedTarget(steps: readonly FormGuidanceStep[]): string | undefined {
  return steps.find((item) => item.key === "intended_target")?.body;
}

/**
 * Searchable guidance: one entry per slot, so a future search surface can find
 * "range of motion" text without parsing prose.
 */
export function searchableGuidance(steps: readonly FormGuidanceStep[]): Array<{
  key: FormGuidanceStepKey;
  heading: string;
  body: string;
}> {
  return orderedSteps(steps).map((step) => ({
    key: step.key,
    heading: step.heading,
    body: step.body,
  }));
}
