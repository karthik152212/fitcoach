import type {
  ExerciseCategory,
  ExercisePreferenceKind,
  ExerciseRole,
  MovementFunction,
  MovementPattern,
  MuscleGroup,
} from "@fitcoach/domain";
import type { ExerciseKnowledge } from "./knowledgeCatalog";

/**
 * Exercise universe (Phase 2, §5/§6).
 *
 * The universe is DERIVED, never stored: given the user's equipment, their
 * constraints, their goal and their preferences, the set of exercises they can
 * actually perform is computed. That ordering matters — equipment is
 * established first, and the exercise pool follows from it, so the future UX
 * can ask progressively ("Do you have a barbell?") instead of demanding one
 * giant checklist.
 *
 * Crucially, "unavailable" is not the same as "unknown". An exercise the user
 * cannot perform is still returned, flagged, and explainable: it is what lets
 * the substitution engine offer it *as an alternative requiring different
 * equipment* rather than silently dropping it from the catalog.
 */

export interface EquipmentContext {
  /** Equipment ids the user has and can use. */
  availableEquipmentIds: readonly string[];
  /**
   * Equipment the user owns but cannot use right now ("the machine is busy").
   * Exercises are excluded from *selection* but stay available as alternatives.
   */
  temporarilyUnavailableEquipmentIds?: readonly string[];
  /** Equipment the user has explicitly removed from their inventory. */
  retiredEquipmentIds?: readonly string[];
}

export interface ExerciseUniverseFilters {
  targetMuscleIds?: readonly string[];
  targetMuscleSlugs?: readonly string[];
  /** Heads/regions to match; a structure match implies its parent muscle. */
  targetStructureIds?: readonly string[];
  movementPatterns?: readonly MovementPattern[];
  movementFunctions?: readonly MovementFunction[];
  roles?: readonly ExerciseRole[];
  categories?: readonly ExerciseCategory[];
  muscleGroups?: readonly MuscleGroup[];
  /** Retired exercises are hidden unless explicitly requested. */
  includeRetired?: boolean;
  excludeExerciseIds?: readonly string[];
  /**
   * When true (the default), exercises the user cannot perform are still
   * returned, flagged `available: false`. Filtering them out is a planner
   * decision, not a knowledge-layer one.
   */
  includeUnavailable?: boolean;
}

export interface ExerciseUniverseEntry {
  exercise: ExerciseKnowledge;
  /** Every required item is available and usable. */
  available: boolean;
  /** Required items the user does not own at all. */
  missingEquipmentIds: readonly string[];
  /** Required items the user owns but cannot use right now. */
  temporarilyBlockedEquipmentIds: readonly string[];
  /** True when the user has excluded this exercise by preference. */
  excluded: boolean;
  /** Current preference, if the user has expressed one. */
  preference?: ExercisePreferenceKind;
}

export interface ExerciseUniverseRequest {
  equipment: EquipmentContext;
  filters?: ExerciseUniverseFilters;
  /** exerciseId → preference, already resolved to the applicable date. */
  preferences?: Readonly<Record<string, ExercisePreferenceKind>>;
}

function requiredEquipmentStatus(
  exercise: ExerciseKnowledge,
  equipment: EquipmentContext,
): Pick<ExerciseUniverseEntry, "available" | "missingEquipmentIds" | "temporarilyBlockedEquipmentIds"> {
  const available = new Set(equipment.availableEquipmentIds);
  const temporary = new Set(equipment.temporarilyUnavailableEquipmentIds ?? []);
  const retired = new Set(equipment.retiredEquipmentIds ?? []);

  const missing: string[] = [];
  const blocked: string[] = [];
  for (const equipmentId of [...exercise.requiredEquipmentIds].sort()) {
    if (available.has(equipmentId)) continue;
    if (temporary.has(equipmentId)) {
      blocked.push(equipmentId);
      continue;
    }
    // A retired or simply unowned item is "missing" — the user cannot perform
    // the exercise with what they have today.
    if (retired.has(equipmentId)) {
      missing.push(equipmentId);
      continue;
    }
    missing.push(equipmentId);
  }
  return {
    available: missing.length === 0 && blocked.length === 0,
    missingEquipmentIds: missing,
    temporarilyBlockedEquipmentIds: blocked,
  };
}

/**
 * Muscle/structure matching. Filters are AND across categories and OR within
 * one category: an exercise matches when it hits the muscle set OR the
 * structure set, not only when it satisfies both.
 *
 * A structure-level target is also a muscle-level target, because naming a
 * head implies the parent muscle. The reverse is false on purpose: an exercise
 * that trains the whole muscle does not automatically "train the long head".
 */
function matchesTargets(exercise: ExerciseKnowledge, filters: ExerciseUniverseFilters): boolean {
  const muscleIds = filters.targetMuscleIds ?? [];
  const muscleSlugs = filters.targetMuscleSlugs ?? [];
  const structures = new Set(filters.targetStructureIds ?? []);
  if (muscleIds.length === 0 && muscleSlugs.length === 0 && structures.size === 0) return true;

  return exercise.targets.some(
    (target) =>
      muscleIds.includes(target.muscleId) ||
      muscleSlugs.includes(target.muscleSlug) ||
      (target.structureId !== undefined && structures.has(target.structureId)),
  );
}

function matchesGroup(exercise: ExerciseKnowledge, filters: ExerciseUniverseFilters): boolean {
  const groups = filters.muscleGroups;
  if (!groups || groups.length === 0) return true;
  return exercise.targets.some((target) => groups.includes(target.muscleGroup));
}

/**
 * Derive the user's exercise universe.
 *
 * Ordering is deterministic: unavailable entries first (so a planner sees the
 * "nearly there" options), then available entries by slug.
 */
export function buildExerciseUniverse(
  catalog: readonly ExerciseKnowledge[],
  request: ExerciseUniverseRequest,
): ExerciseUniverseEntry[] {
  const filters = request.filters ?? {};
  const preferences = request.preferences ?? {};
  const excluded = new Set(filters.excludeExerciseIds ?? []);

  const entries: ExerciseUniverseEntry[] = [];
  for (const exercise of catalog) {
    if (excluded.has(exercise.id)) continue;
    // A retired exercise is one the catalog can no longer say what it trains.
    if (!filters.includeRetired && !isSelectable(exercise)) continue;
    if (filters.categories && filters.categories.length > 0 && !filters.categories.includes(exercise.category)) {
      continue;
    }
    if (
      filters.movementPatterns &&
      filters.movementPatterns.length > 0 &&
      (!exercise.movementPattern || !filters.movementPatterns.includes(exercise.movementPattern))
    ) {
      continue;
    }
    if (
      filters.movementFunctions &&
      filters.movementFunctions.length > 0 &&
      !exercise.movementFunctions.some((fn) => filters.movementFunctions!.includes(fn))
    ) {
      continue;
    }
    if (
      filters.roles &&
      filters.roles.length > 0 &&
      !exercise.roles.some((role) => filters.roles!.includes(role))
    ) {
      continue;
    }
    if (!matchesGroup(exercise, filters)) continue;
    if (!matchesTargets(exercise, filters)) continue;

    const status = requiredEquipmentStatus(exercise, request.equipment);
    const preference = preferences[exercise.id];
    const isExcluded = preference === "excluded";

    if (!status.available && filters.includeUnavailable === false && !isExcluded) continue;

    entries.push({
      exercise,
      ...status,
      excluded: isExcluded,
      ...(preference !== undefined ? { preference } : {}),
    });
  }

  return entries.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    return a.exercise.slug.localeCompare(b.exercise.slug);
  });
}

/**
 * Selectable means "the catalog knows what it is for". A row with no targeting
 * at all is retired in spirit even if `is_active` has not caught up yet, and
 * must never enter selection.
 */
function isSelectable(exercise: ExerciseKnowledge): boolean {
  return exercise.targets.some((target) => target.role === "primary_mover");
}

/** Convenience: the exercises a user can perform right now, excluding dislikes. */
export function availableExercises(
  entries: readonly ExerciseUniverseEntry[],
): ExerciseUniverseEntry[] {
  return entries.filter((entry) => entry.available && !entry.excluded);
}
