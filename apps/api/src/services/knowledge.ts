import type {
  CalendarDate,
  ExercisePreferenceKind,
  GoalKind,
  MovementFunction,
  MovementPattern,
  SuitabilityTier,
  TrainingExperience,
} from "@fitcoach/domain";
import type {
  ExerciseKnowledgeRecord,
  MuscleWithStructures,
  Repositories,
  SearchExercisesQuery,
} from "@fitcoach/db";
import { NotFoundError } from "@fitcoach/db";
import {
  assessCoverage,
  buildExerciseDecision,
  buildExerciseUniverse,
  buildTargetMap,
  explainExerciseDecision,
  findSubstitutions,
  goalProfileFor,
  quickInstructions,
  validateFormGuidance,
  videoCaptions,
} from "@fitcoach/fitness-core";
import type {
  ExerciseDecision,
  ExerciseExplanation,
  MuscleTaxonomy,
  SubstitutionTrigger,
} from "@fitcoach/fitness-core";
import type { ExerciseKnowledge } from "@fitcoach/fitness-core";

/**
 * Exercise knowledge service (Phase 2).
 *
 * This is the application layer between HTTP and the deterministic engines. It
 * does four things and nothing else:
 *
 *   1. loads catalog/context data from repositories,
 *   2. translates it into the pure shapes `fitness-core` consumes,
 *   3. calls the engine,
 *   4. shapes the engine output for the response.
 *
 * It contains no scoring, no ranking, no overlap maths and no anatomy logic —
 * all of that lives in the deterministic package so it can be tested and cited
 * as evidence without a database.
 */
export class KnowledgeService {
  constructor(private readonly repos: Repositories) {}

  // -----------------------------------------------------------------------
  // Catalog reads
  // -----------------------------------------------------------------------

  /** Muscle taxonomy: every muscle with its heads/regions/portions. */
  async muscleCatalog(options?: { includeInactive?: boolean }): Promise<MuscleWithStructures[]> {
    return this.repos.exercises.listMuscleTaxonomy(options);
  }

  async muscleById(muscleId: string): Promise<MuscleWithStructures> {
    const taxonomy = await this.repos.exercises.listMuscleTaxonomy({ includeInactive: true });
    const found = taxonomy.find(
      (entry) =>
        entry.muscle.id === muscleId || entry.muscle.slug === muscleId || entry.muscle.externalId === muscleId,
    );
    if (!found) throw new NotFoundError(`muscle ${muscleId} not found`);
    return found;
  }

  async movementFunctions(): Promise<
    Array<{ slug: MovementFunction; name: string; region: string; description?: string }>
  > {
    const functions = await this.repos.exercises.listMovementFunctions();
    return functions.map((item) => ({
      slug: item.slug as MovementFunction,
      name: item.name,
      region: item.region,
      ...(item.description !== undefined ? { description: item.description } : {}),
    }));
  }

  async searchExercises(query?: SearchExercisesQuery): Promise<ExerciseKnowledgeRecord[]> {
    return this.repos.exercises.listExerciseKnowledge(query);
  }

  async exerciseById(idOrSlug: string): Promise<ExerciseKnowledgeRecord> {
    const exercise = await this.repos.exercises.findExerciseKnowledge(idOrSlug);
    if (!exercise) throw new NotFoundError(`exercise ${idOrSlug} not found`);
    return exercise;
  }

  /** Full exercise card data: knowledge, form guidance, media, alternatives. */
  async exerciseDetail(idOrSlug: string, options?: { includeRetiredMedia?: boolean }): Promise<{
    exercise: ExerciseKnowledgeRecord;
    formGuidance: Awaited<ReturnType<KnowledgeService["formGuidance"]>>;
    media: Awaited<ReturnType<KnowledgeService["mediaMetadata"]>>;
    targetMap: ReturnType<typeof buildTargetMap>;
    curatedSubstitutions: Awaited<ReturnType<KnowledgeService["curatedSubstitutions"]>>;
  }> {
    const exercise = await this.exerciseById(idOrSlug);
    const [formGuidance, media, curatedSubstitutions] = await Promise.all([
      this.formGuidance(exercise.id),
      this.mediaMetadata(exercise.id, options?.includeRetiredMedia),
      this.curatedSubstitutions(exercise.id),
    ]);
    return {
      exercise,
      formGuidance,
      media,
      targetMap: buildTargetMap(toKnowledge(exercise)),
      curatedSubstitutions,
    };
  }

  // -----------------------------------------------------------------------
  // Structured form guidance and media metadata
  // -----------------------------------------------------------------------

  async formGuidance(exerciseId: string): Promise<{
    version: number;
    status: string;
    effectiveFrom: CalendarDate;
    reviewNotes?: string;
    steps: Array<{ key: string; heading: string; body: string; position: number }>;
    validation: ReturnType<typeof validateFormGuidance>;
    quickInstructions: string[];
    videoCaptions: Array<{ key: string; caption: string }>;
  } | null> {
    const version = await this.repos.knowledge.findActiveFormVersion(exerciseId);
    if (!version) return null;
    return {
      version: version.version,
      status: version.status,
      effectiveFrom: version.effectiveFrom,
      ...(version.reviewNotes !== undefined ? { reviewNotes: version.reviewNotes } : {}),
      steps: version.steps,
      validation: validateFormGuidance(version.steps),
      quickInstructions: quickInstructions(version.steps),
      videoCaptions: videoCaptions(version.steps),
    };
  }

  async mediaMetadata(exerciseId: string, includeRetired = false) {
    return this.repos.knowledge.listMediaAssets(exerciseId, includeRetired);
  }

  async curatedSubstitutions(exerciseId: string) {
    return this.repos.knowledge.listSubstitutions(exerciseId);
  }

  // -----------------------------------------------------------------------
  // User context
  // -----------------------------------------------------------------------

  /**
   * The user's current equipment, honouring the availability column so "the
   * machine is busy" is a first-class state rather than a missing row.
   */
  private async equipmentContext(userId: string, at?: CalendarDate) {
    const rows = await this.repos.equipment.listUserEquipment(userId, at);
    const available: string[] = [];
    const temporary: string[] = [];
    const retired: string[] = [];
    for (const row of rows) {
      if (row.availability === "available") available.push(row.equipment.id);
      else if (row.availability === "temporarily_unavailable") temporary.push(row.equipment.id);
      else retired.push(row.equipment.id);
    }
    return {
      equipment: { availableEquipmentIds: available, temporarilyUnavailableEquipmentIds: temporary, retiredEquipmentIds: retired },
      rows,
    };
  }

  private async preferences(userId: string, at?: CalendarDate): Promise<Record<string, ExercisePreferenceKind>> {
    const rows = await this.repos.exercisePreferences.listCurrentPreferences(userId, at);
    const result: Record<string, ExercisePreferenceKind> = {};
    // Open intervals only; if history is ever replayed, the applicable row wins.
    for (const row of rows.filter((item) => item.validTo === undefined)) {
      result[row.exerciseId] = row.preference;
    }
    return result;
  }

  private async profileContext(
    userId: string,
    goalKind?: GoalKind,
    goalPriorities?: readonly string[],
  ) {
    const [user, goal, profile] = await Promise.all([
      this.repos.users.findById(userId),
      goalKind ? Promise.resolve(null) : this.repos.goals.active(userId),
      this.repos.profiles.get(userId),
    ]);
    const resolvedKind = goalKind ?? goal?.kind ?? "general_fitness";
    const resolvedPriorities = goalPriorities ?? goal?.priorities ?? [];
    const goalProfile = goalProfileFor({ kind: resolvedKind, priorities: resolvedPriorities });
    if (!user) throw new NotFoundError(`user ${userId} not found`);
    return {
      user,
      goalKind: resolvedKind,
      goalPriorities: resolvedPriorities,
      goalProfile,
      trainingExperience: profile?.trainingExperience as TrainingExperience | undefined,
      limitations: profile?.limitations ?? [],
    };
  }

  // -----------------------------------------------------------------------
  // User exercise preferences
  // -----------------------------------------------------------------------

  /**
   * Record a preference. Recording closes the currently open interval and opens
   * a new one, so "I hate barbell squats" recorded today cannot change what an
   * older workout meant.
   */
  async setExercisePreference(
    userId: string,
    input: {
      exerciseId: string;
      preference: ExercisePreferenceKind;
      validFrom: CalendarDate;
      reason?: string;
    },
  ) {
    return this.repos.exercisePreferences.setPreference({
      userId,
      ...input,
    });
  }

  async exercisePreferences(userId: string, at?: CalendarDate) {
    return this.repos.exercisePreferences.listPreferences(userId, at);
  }

  // -----------------------------------------------------------------------
  // Derived, deterministic surfaces
  // -----------------------------------------------------------------------

  async exerciseUniverse(
    userId: string,
    options?: {
      at?: CalendarDate;
      targetMuscleSlugs?: readonly string[];
      movementPattern?: MovementPattern;
      movementFunction?: MovementFunction;
      includeUnavailable?: boolean;
      includeRetired?: boolean;
      goalKind?: GoalKind;
    },
  ) {
    const [catalog, { equipment: equipmentContextState }, preferences] = await Promise.all([
      this.repos.exercises.listExerciseKnowledge(
        options?.includeRetired === true ? { includeInactive: true } : undefined,
      ),
      this.equipmentContext(userId, options?.at),
      this.preferences(userId, options?.at),
    ]);
    return buildExerciseUniverse(catalog.map(toKnowledge), {
      equipment: equipmentContextState,
      preferences,
      filters: {
        ...(options?.targetMuscleSlugs !== undefined
          ? { targetMuscleSlugs: options.targetMuscleSlugs }
          : {}),
        ...(options?.movementPattern !== undefined
          ? { movementPatterns: [options.movementPattern] }
          : {}),
        ...(options?.movementFunction !== undefined
          ? { movementFunctions: [options.movementFunction] }
          : {}),
        ...(options?.includeUnavailable !== undefined
          ? { includeUnavailable: options.includeUnavailable }
          : {}),
        ...(options?.includeRetired !== undefined ? { includeRetired: options.includeRetired } : {}),
      },
    });
  }

  /** Deterministic suitability + explanation for one exercise in this context. */
  async exerciseDecision(
    userId: string,
    exerciseIdOrSlug: string,
    options?: {
      at?: CalendarDate;
      goalKind?: GoalKind;
      goalPriorities?: readonly string[];
      targetMuscleSlugs?: readonly string[];
      alongsideExerciseIds?: readonly string[];
      includeAlternatives?: boolean;
      alternativeLimit?: number;
      explain?: boolean;
      trigger?: SubstitutionTrigger;
    },
  ): Promise<{
    decision: ExerciseDecision;
    explanation?: ExerciseExplanation;
    substitutions?: Array<{
      exercise: string;
      slug: string;
      rank: number;
      tier: SuitabilityTier;
      reasons: string[];
      curated: boolean;
      extraEquipmentIds: string[];
      preservation: Record<string, number>;
    }>;
  }> {
    const exercise = await this.exerciseById(exerciseIdOrSlug);
    const [context, { equipment: equipmentContextState }, preferences, catalog, curated] = await Promise.all([
      this.profileContext(userId, options?.goalKind, options?.goalPriorities),
      this.equipmentContext(userId, options?.at),
      this.preferences(userId, options?.at),
      this.repos.exercises.listExerciseKnowledge(),
      this.curatedSubstitutions(exercise.id),
    ]);

    const knowledgeCatalog = catalog.map(toKnowledge);
    const decision = buildExerciseDecision({
      exercise: toKnowledge(exercise),
      context: {
        userId,
        goalProfile: context.goalProfile.profile,
        goalPriorities: context.goalProfile.priorities,
        availableEquipmentIds: equipmentContextState.availableEquipmentIds,
        limitations: context.limitations,
        ...(context.trainingExperience !== undefined
          ? { trainingExperience: context.trainingExperience }
          : {}),
        ...(options?.at !== undefined ? { asOf: options.at } : {}),
      },
      catalog: knowledgeCatalog,
      ...(options?.alongsideExerciseIds !== undefined
        ? { alongsideExerciseIds: options.alongsideExerciseIds }
        : {}),
      ...(options?.targetMuscleSlugs !== undefined
        ? { targetMuscleSlugs: options.targetMuscleSlugs }
        : {}),
      preferences,
      temporarilyUnavailableEquipmentIds: equipmentContextState.temporarilyUnavailableEquipmentIds,
      limitations: context.limitations,
      curatedSubstitutions: curated.map((row) => ({
        exerciseId: row.exerciseId,
        substituteExerciseId: row.substituteExerciseId,
        trigger: row.trigger as SubstitutionTrigger,
        reason: row.reason,
        rankHint: row.rankHint,
      })),
      ...(options?.includeAlternatives !== undefined
        ? { includeAlternatives: options.includeAlternatives }
        : {}),
      ...(options?.alternativeLimit !== undefined ? { alternativeLimit: options.alternativeLimit } : {}),
    });

    // A scenario trigger narrows the alternatives to the replacements that
    // situation actually allows, without changing the decision itself.
    const substitutions =
      options?.trigger !== undefined
        ? findSubstitutions({
            exercise: toKnowledge(exercise),
            catalog: knowledgeCatalog,
            context: {
              goalProfile: context.goalProfile.profile,
              goalPriorities: context.goalProfile.priorities,
              availableEquipmentIds: equipmentContextState.availableEquipmentIds,
              ...(context.trainingExperience !== undefined
                ? { trainingExperience: context.trainingExperience }
                : {}),
            },
            trigger: options.trigger,
            preferences,
            temporarilyUnavailableEquipmentIds: equipmentContextState.temporarilyUnavailableEquipmentIds,
            limitations: context.limitations,
            curated: curated.map((row) => ({
              exerciseId: row.exerciseId,
              substituteExerciseId: row.substituteExerciseId,
              trigger: row.trigger as SubstitutionTrigger,
              reason: row.reason,
              rankHint: row.rankHint,
            })),
            limit: options.alternativeLimit ?? 5,
          }).map((item) => ({
            exercise: item.exercise.name,
            slug: item.exercise.slug,
            rank: item.rank,
            tier: item.tier,
            reasons: [...item.reasons],
            curated: item.curated,
            extraEquipmentIds: [...item.extraEquipmentIds],
            preservation: { ...item.preservation },
          }))
        : undefined;

    return {
      decision,
      ...(options?.explain === false ? {} : { explanation: explainExerciseDecision(decision) }),
      ...(substitutions !== undefined ? { substitutions } : {}),
    };
  }

  /** What a set of selected exercises actually covers. */
  async muscleCoverage(
    userId: string,
    exerciseIds: readonly string[],
    options?: { focusMuscleSlugs?: readonly string[]; focusStructureIds?: readonly string[] },
  ) {
    const catalog = await this.repos.exercises.listExerciseKnowledge();
    const byId = new Map(catalog.map((item) => [item.id, item]));
    const selected: ExerciseKnowledge[] = [];
    for (const id of exerciseIds) {
      const exercise = byId.get(id);
      if (exercise) selected.push(toKnowledge(exercise));
    }

    const taxonomyMuscles = await this.repos.exercises.listMuscleTaxonomy();
    const focusMuscleIds = options?.focusMuscleSlugs?.length
      ? taxonomyMuscles
          .filter((entry) => options.focusMuscleSlugs!.includes(entry.muscle.slug))
          .map((entry) => entry.muscle.id)
      : undefined;

    const taxonomy: MuscleTaxonomy = {
      muscles: taxonomyMuscles.map((entry) => ({
        id: entry.muscle.id,
        slug: entry.muscle.slug,
        name: entry.muscle.name,
        displayName: entry.muscle.displayName ?? entry.muscle.name,
        group: entry.muscle.group,
        isActive: entry.muscle.isActive,
      })),
      structures: taxonomyMuscles.flatMap((entry) =>
        entry.structures.map((structure) => ({
          id: structure.id,
          muscleId: structure.muscleId,
          slug: structure.slug,
          name: structure.name,
          displayName: structure.displayName ?? structure.name,
          kind: structure.kind,
          isActive: structure.isActive,
        })),
      ),
    };

    void userId; // user context arrives through focus selections and Phase 3.
    return assessCoverage({
      exercises: selected,
      taxonomy,
      ...(focusMuscleIds !== undefined ? { focusMuscleIds } : {}),
      ...(options?.focusStructureIds !== undefined
        ? { focusStructureIds: options.focusStructureIds }
        : {}),
    });
  }
}

/**
 * Map the persistence read model onto the pure engine shape. They are already
 * structurally compatible; this function exists so the dependency is explicit
 * and so a future field addition is caught by the compiler in one place.
 */
export function toKnowledge(record: ExerciseKnowledgeRecord): ExerciseKnowledge {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    aliases: record.aliases,
    ...(record.instructions !== undefined ? { summary: record.instructions } : {}),
    category: record.category,
    ...(record.movementPattern !== undefined ? { movementPattern: record.movementPattern } : {}),
    ...(record.variationKey !== undefined ? { variationKey: record.variationKey } : {}),
    ...(record.variationLabel !== undefined ? { variationLabel: record.variationLabel } : {}),
    unilateral: record.unilateral,
    requiredEquipmentIds: record.requiredEquipmentIds,
    ...(record.stabilityDemand !== undefined ? { stabilityDemand: record.stabilityDemand } : {}),
    ...(record.loadingCharacteristic !== undefined
      ? { loadingCharacteristic: record.loadingCharacteristic }
      : {}),
    ...(record.rangeOfMotionCharacteristic !== undefined
      ? { rangeOfMotionCharacteristic: record.rangeOfMotionCharacteristic }
      : {}),
    movementFunctions: record.movementFunctions,
    ...(record.primaryMovementFunction !== undefined
      ? { primaryMovementFunction: record.primaryMovementFunction }
      : {}),
    roles: record.roles,
    targets: record.targets,
    knowledgeVersion: record.knowledgeVersion,
  };
}
