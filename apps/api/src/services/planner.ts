import type {
  CalendarDate,
  EnvironmentLimitation,
  ExercisePerformance,
  ExercisePerformanceSummary,
  GoalContext,
  GoalKind,
  MuscleGroup,
  PlannedExercise,
  PlanSummary,
  PlateauSignal,
  ProgressionLedgerEntry,
  ProgressionStatus,
  TrainingContext,
  TrainingEnvironment,
  TrainingExperience,
  TrainingGoalProfile,
  TrainingState,
} from "@fitcoach/domain";
import type {
  ExerciseKnowledgeRecord,
  PlanAggregate,
  PlanConstraintInput,
  PlanConstraintRecord,
  PlanDecisionRecord,
  PlanGenerationReason,
  PlanVersionInput,
  PlanVersionRecord,
  ProgressionRuleRecord,
  Repositories,
} from "@fitcoach/db";
import { ConstraintValidationError, NotFoundError } from "@fitcoach/db";
import {
  TRAINING_CONFIG_VERSION,
  assessFrequency,
  assessVolumeAppropriateness,
  buildProgressionRule,
  buildSessionFromAssignments,
  comparePlans,
  detectPlateauSignals,
  distributeFrequency,
  type SessionAssignment,
  evaluateGoalAlignment,
  evaluatePlanQuality,
  estimateSessionDuration,
  generateSplit,
  generateWeeklyVolumeReport,
  getMuscleVolumeTarget,
  goalProfileFor,
  makeAdaptationDecision,
  recommendVolumeAdjustments,
  repairOverBudgetSession,
  scoreFromAssessment,
  scoreSessionDuration,
  selectSplit,
  summarizePlanComparison,
  evaluateProgression,
  applyVolumeAdjustments,
  adaptExercisesToEnvironment,
  environmentProgressionMechanisms,
  buildLedgerEntry,
  compareLedgerEntries,
  countCompletedProgressions,
  progressionMechanismsFor,
  resolveTrainingEnvironment,
  type EnvironmentSubstitution,
  type ExerciseKnowledge,
  type GeneratedSplit,
  type PlanQualityEvaluation,
  type VolumeAdjustment,
  type WeeklyVolumeReport,
} from "@fitcoach/fitness-core";
import { toKnowledge } from "./knowledge";

/**
 * Adaptive training planner (Phase 3).
 *
 * This is the application layer between HTTP and the deterministic engines in
 * `@fitcoach/fitness-core`. It:
 *
 *   1. loads user/goal/equipment/preference/history context from repositories,
 *   2. translates it into the pure shapes the engines consume,
 *   3. calls the engines (split → frequency → session construction → duration
 *      → volume → constraints → quality → adaptation),
 *   4. persists versions, decisions, constraints and progression rules,
 *   5. shapes the result for the response.
 *
 * No scoring, no volume maths and no ranking live here — that keeps every
 * number reproducible from the pure package and citable as evidence.
 */

export interface PlanGenerationCommand {
  /** Append a version to this plan instead of creating a new one. */
  planId?: string;
  name?: string;
  goalId?: string;
  goalKind?: GoalKind;
  priorities?: readonly string[];
  availableTrainingDays?: number;
  maxSessionDurationMinutes?: number;
  experience?: TrainingExperience;
  /** Overrides the user's stored equipment for this request. */
  equipmentIds?: readonly string[];
  /**
   * Bounded weekly-volume changes applied to the generated sessions (Phase 3
   * adaptation). The pure engine spreads each muscle's signed delta one set at
   * a time and respects set bounds.
   */
  volumeAdjustments?: readonly VolumeAdjustment[];
  asOf: CalendarDate;
  generationReason?: PlanGenerationReason;
  // -- Phase 3.1 environment adaptation --
  /**
   * Resolved environment the plan is being generated for. When present, its
   * equipment universe replaces the stored one and its limitations are
   * reported explicitly instead of being hidden behind a "normal" plan.
   */
  environment?: TrainingEnvironment;
  /** `temporary_environment` plans never replace the gym plan (§21). */
  planKind?: "primary" | "temporary_environment";
  /** The version a temporary plan was adapted from. */
  temporaryForVersionId?: string;
  /** Last user-local day a temporary plan applies. */
  effectiveUntil?: CalendarDate;
}

export interface SessionPlanView {
  position: number;
  name: string;
  sessionType: string;
  suggestedDay: string;
  weekdayHint: number;
  exercises: readonly PlannedExercise[];
  estimatedMinutes: number;
  targetMinutes: number;
  exceedsBudget: boolean;
}

export interface PlanQualityView extends PlanQualityEvaluation {
  /** Domain-shaped copy for the future UI contract. */
  totalScore: number;
}

export interface GeneratePlanResult {
  feasibility: "feasible" | "feasible_with_tradeoffs" | "infeasible";
  infeasibilityReasons: readonly string[];
  plan?: PlanAggregate;
  version?: PlanVersionRecord;
  split?: GeneratedSplit;
  sessions?: readonly SessionPlanView[];
  volume?: WeeklyVolumeReport;
  quality?: PlanQualityView;
  constraints?: readonly PlanConstraintRecord[];
  decision?: PlanDecisionRecord;
  warnings: readonly string[];
  /** Environment the plan was generated for, when one applied (Phase 3.1). */
  environment?: TrainingEnvironment;
  /** Environment-forced exercise substitutions, honesty-labelled. */
  substitutions?: readonly EnvironmentSubstitution[];
  /** Stimulus the environment could not reproduce. */
  limitations?: readonly EnvironmentLimitation[];
  /** Ordered progression levers the generated plan can use. */
  progressionMechanisms?: readonly string[];
}

export interface AdaptPlanResult {
  outcome: string;
  rationale: string;
  smallestUsefulChangeJustification: string;
  triggeringSignals: readonly PlateauSignal[];
  /** The decision row written for this evaluation (always present). */
  decision: PlanDecisionRecord;
  /** Set when the intervention produced a new plan version. */
  newVersion?: PlanVersionRecord;
  comparisonSummary?: readonly string[];
  monitoringPlan: readonly string[];
}

/** Result of asking for a temporary environment-adapted plan (Phase 3.1 §15). */
export interface TemporaryPlanResult {
  /** The environment the request was evaluated against (always present). */
  environment: TrainingEnvironment;
  /** False when no temporary plan was created, with the reason why. */
  needed: boolean;
  reason?: string;
  /** Primary plan the temporary plan was adapted from. */
  sourcePlanId?: string;
  sourceVersionId?: string;
  /** Present only when `needed` is true. */
  result?: GeneratePlanResult;
}

interface ResolvedContext {
  userId: string;
  asOf: CalendarDate;
  context: TrainingContext;
  goalContext: GoalContext;
  goalProfile: TrainingGoalProfile;
  catalog: ExerciseKnowledge[];
  catalogByMuscle: Readonly<Record<string, readonly ExerciseKnowledge[]>>;
  preferences: Readonly<Record<string, "preferred" | "neutral" | "disliked" | "excluded">>;
  warnings: string[];
}

const DEFAULT_DAYS = 3;
const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_EXPERIENCE: TrainingExperience = "intermediate";

export class TrainingPlannerService {
  constructor(private readonly repos: Repositories) {}

  // -------------------------------------------------------------------------
  // Context loading
  // -------------------------------------------------------------------------

  private async resolveContext(
    userId: string,
    command: {
      goalId?: string;
      goalKind?: GoalKind;
      priorities?: readonly string[];
      availableTrainingDays?: number;
      maxSessionDurationMinutes?: number;
      experience?: TrainingExperience;
      equipmentIds?: readonly string[];
      environment?: TrainingEnvironment;
      asOf: CalendarDate;
    },
  ): Promise<ResolvedContext> {
    const warnings: string[] = [];

    const user = await this.repos.users.findById(userId);
    if (!user) throw new NotFoundError(`user ${userId} not found`);

    const profile = await this.repos.profiles.get(userId);
    const goal = command.goalId
      ? await this.repos.goals.findById(command.goalId)
      : await this.repos.goals.active(userId);
    if (command.goalId && !goal) throw new NotFoundError(`goal ${command.goalId} not found`);

    const goalKind: GoalKind = command.goalKind ?? goal?.kind ?? "general_fitness";
    const priorities = command.priorities ?? goal?.priorities ?? [];

    const availableTrainingDays =
      command.availableTrainingDays ??
      profile?.trainingDaysPerWeek ??
      DEFAULT_DAYS;
    const maxSessionDurationMinutes =
      command.maxSessionDurationMinutes ??
      profile?.sessionDurationMinutes ??
      DEFAULT_DURATION_MINUTES;
    const trainingExperience = command.experience ?? profile?.trainingExperience ?? DEFAULT_EXPERIENCE;

    if (availableTrainingDays <= 0) {
      warnings.push("No training days available; plan generation will report infeasibility.");
    }

    // Equipment: an active environment narrows the universe first; otherwise an
    // explicit override wins, and otherwise the stored availability rows apply
    // (so "the machine is busy" is respected at planning time).
    let availableEquipmentIds: readonly string[];
    let temporarilyUnavailableEquipmentIds: readonly string[] = [];
    if (command.environment) {
      availableEquipmentIds = command.environment.availableEquipmentIds;
      temporarilyUnavailableEquipmentIds = command.environment.unavailableEquipmentIds;
      if (command.environment.constrained) {
        warnings.push(
          `Training in a ${command.environment.kind} environment: ${command.environment.availableEquipmentIds.length} equipment item(s) available.`,
        );
        for (const limitation of command.environment.limitations) {
          warnings.push(`Environment limitation (${limitation.kind}/${limitation.subject}): ${limitation.description}`);
        }
      }
    } else if (command.equipmentIds) {
      availableEquipmentIds = command.equipmentIds;
    } else {
      const rows = await this.repos.equipment.listUserEquipment(userId, command.asOf);
      availableEquipmentIds = rows
        .filter((row) => row.availability === "available")
        .map((row) => row.equipment.id);
      temporarilyUnavailableEquipmentIds = rows
        .filter((row) => row.availability === "temporarily_unavailable")
        .map((row) => row.equipment.id);
      if (rows.length === 0) {
        warnings.push(
          "No equipment recorded for this user; the planner assumes bodyweight-only training is possible.",
        );
      }
    }

    const preferenceRows = await this.repos.exercisePreferences.listCurrentPreferences(
      userId,
      command.asOf,
    );
    const preferences: Record<string, "preferred" | "neutral" | "disliked" | "excluded"> = {};
    for (const row of preferenceRows) preferences[row.exerciseId] = row.preference;

    const catalogRecords = await this.repos.exercises.listExerciseKnowledge();
    const catalog = catalogRecords.map((record: ExerciseKnowledgeRecord) => toKnowledge(record));

    const byMuscle = new Map<string, Map<string, ExerciseKnowledge>>();
    for (const exercise of catalog) {
      for (const entry of exercise.targets) {
        const bucket = byMuscle.get(entry.muscleSlug) ?? new Map<string, ExerciseKnowledge>();
        bucket.set(exercise.id, exercise);
        byMuscle.set(entry.muscleSlug, bucket);
      }
    }

    const context: TrainingContext = {
      userId,
      timezone: user.timezone,
      ...(profile?.birthDate ? { birthDate: profile.birthDate } : {}),
      ...(profile?.sex ? { sex: profile.sex } : {}),
      ...(profile?.heightCm !== undefined ? { heightCm: profile.heightCm } : {}),
      trainingExperience,
      ...(profile?.limitations ? { limitations: profile.limitations } : {}),
      availableTrainingDays,
      maxSessionDurationMinutes,
      exercisePreferences: preferences,
      availableEquipmentIds,
      temporarilyUnavailableEquipmentIds,
      asOf: command.asOf,
    };

    const goalContext: GoalContext = {
      goalId: goal?.id ?? "goal_none",
      goalKind,
      goalStartDate: goal?.effectiveFrom ?? command.asOf,
      priorities,
      physiquePriorities: priorities,
    };

    return {
      userId,
      asOf: command.asOf,
      context,
      goalContext,
      goalProfile: goalProfileFor({ kind: goalKind, priorities }).profile,
      catalog,
      catalogByMuscle: Object.fromEntries(
        [...byMuscle.entries()].map(([slug, bucket]) => [slug, [...bucket.values()]]),
      ),
      preferences,
      warnings,
    };
  }

  // -------------------------------------------------------------------------
  // Plan generation
  // -------------------------------------------------------------------------

  async generatePlan(userId: string, command: PlanGenerationCommand): Promise<GeneratePlanResult> {
    const resolved = await this.resolveContext(userId, command);
    const warnings = [...resolved.warnings];
    const { context, goalContext, goalProfile } = resolved;

    const split = selectSplit(
      {
        availableTrainingDays: context.availableTrainingDays,
        maxSessionDurationMinutes: context.maxSessionDurationMinutes,
        trainingExperience: context.trainingExperience,
        ...(context.limitations ? { limitations: context.limitations } : {}),
      },
      goalContext,
    );

    if (split.sessionsPerWeek === 0) {
      return {
        feasibility: "infeasible",
        infeasibilityReasons: [
          `${context.availableTrainingDays} available training day(s) cannot produce a plan.`,
        ],
        warnings,
      };
    }

    // Weekly set targets per muscle (ranges, not point claims).
    const muscleTargets: Record<string, number> = {};
    for (const slug of Object.keys(getTrackedMuscleSlugs())) {
      const target = getMuscleVolumeTarget(slug, context.trainingExperience, goalProfile);
      if (target) muscleTargets[slug] = target.preferred;
    }

    const frequency = distributeFrequency(
      muscleTargets,
      split.sessionsPerWeek,
      goalProfile,
      context.trainingExperience,
      split.type,
    );
    warnings.push(...frequency.warnings);

    // Phase 3.1.1: the tracked volume vocabulary is group-level ("calves",
    // "abdominals", "deltoid_anterior", ...) while the knowledge catalog is
    // muscle-level ("gastrocnemius", "rectus_abdominis", "deltoid_front").
    // Bridge the two where — and only where — the catalog actually offers the
    // muscle-level slug; otherwise the assignment keeps its original slug and
    // the engine reports the unfilled slot honestly.
    const sessionAssignments = expandAssignmentsToCatalogMuscles(
      frequency.sessionAssignments,
      resolved.catalogByMuscle,
    );

    const priorityMuscles = goalContext.priorities
      .map((priority) => priorityMuscleSlug(priority))
      .filter((slug): slug is string => slug !== null);

    const sessions: SessionPlanView[] = [];
    const allSubstitutions: EnvironmentSubstitution[] = [];
    const allLimitations: EnvironmentLimitation[] = [];
    for (const splitSession of split.sessions) {
      const assignments = sessionAssignments.filter(
        (assignment) => assignment.sessionIndex === splitSession.weekPosition,
      );

      const built = buildSessionFromAssignments(
        splitSession.weekPosition,
        assignments,
        resolved.catalogByMuscle,
        goalProfile,
        context.trainingExperience,
        {
          availableEquipmentIds: context.availableEquipmentIds,
          exercisePreferences: context.exercisePreferences ?? {},
          temporarilyUnavailableEquipmentIds: context.temporarilyUnavailableEquipmentIds ?? [],
          ...(context.limitations ? { limitations: context.limitations } : {}),
          maxSessionDurationMinutes: context.maxSessionDurationMinutes,
          trainingExperience: context.trainingExperience,
        },
      );
      warnings.push(...built.warnings);

      let exercises = built.sessionExercises;
      if (command.volumeAdjustments && command.volumeAdjustments.length > 0) {
        exercises = applyVolumeAdjustments(exercises, command.volumeAdjustments, resolved.catalog, {
          minSets: goalProfile === "strength" || goalProfile === "athletic" ? 2 : 1,
          maxSets: 8,
        });
      }

      // Phase 3.1: adapt the session to the environment BEFORE duration is
      // estimated, so a temporary plan is budgeted by what it will actually
      // contain rather than by the gym session it replaced.
      if (command.environment && command.environment.constrained) {
        const adapted = adaptExercisesToEnvironment({
          exercises,
          catalog: resolved.catalog,
          environment: command.environment,
          preferences: resolved.preferences,
        });
        exercises = adapted.exercises;
        allSubstitutions.push(...adapted.substitutions);
        allLimitations.push(...adapted.limitations);
        warnings.push(...adapted.warnings);
      }

      let duration = estimateSessionDuration(
        exercises,
        splitSession.sessionType,
        {
          maxSessionDurationMinutes: context.maxSessionDurationMinutes,
          trainingExperience: context.trainingExperience,
        },
        goalProfile,
      );

      if (duration.exceedsBudget && exercises.length > 0) {
        // Deterministic repair order (Part 10): trim redundant sets first,
        // drop low-priority work only if the budget still cannot be met. The
        // repair models its own savings (~2.5 min per set), which can drift
        // from the measured duration, so after every pass the session is
        // re-estimated from what it actually contains and repaired again. The
        // loop stops as soon as the measured duration fits or no further
        // change is possible — a session is never returned over budget while
        // trimmable work remains (Phase 3.1 §16–§18).
        let totalChanges = 0;
        for (let pass = 0; pass < 8 && duration.exceedsBudget && exercises.length > 0; pass++) {
          const repair = repairOverBudgetSession(
            exercises,
            duration.estimatedMinutes,
            context.maxSessionDurationMinutes,
            priorityMuscles,
            goalProfile,
          );
          if (repair.changes.length === 0) break;
          exercises = [...repair.repairedExercises];
          totalChanges += repair.changes.length;
          duration = estimateSessionDuration(
            exercises,
            splitSession.sessionType,
            {
              maxSessionDurationMinutes: context.maxSessionDurationMinutes,
              trainingExperience: context.trainingExperience,
            },
            goalProfile,
          );
        }
        if (totalChanges > 0) {
          warnings.push(
            `Session "${splitSession.name}" was over budget: ${totalChanges} repair change(s) applied.`,
          );
        }
      }

      sessions.push({
        position: splitSession.weekPosition,
        name: splitSession.name,
        sessionType: splitSession.sessionType,
        suggestedDay: splitSession.suggestedDay,
        weekdayHint: weekdayHint(splitSession.suggestedDay),
        exercises,
        estimatedMinutes: duration.estimatedMinutes,
        targetMinutes: context.maxSessionDurationMinutes,
        exceedsBudget: duration.exceedsBudget,
      });
    }

    // Weekly volume + assessments
    const plannedVolume: Record<string, number> = {};
    for (const session of sessions) {
      for (const exercise of session.exercises) {
        plannedVolume[exercise.exerciseId] =
          (plannedVolume[exercise.exerciseId] ?? 0) + exercise.targetSets;
      }
    }

    const volume = generateWeeklyVolumeReport(
      resolved.catalog,
      plannedVolume,
      goalProfile,
      context.trainingExperience,
    );
    const volumeAssessment = assessVolumeAppropriateness(volume, goalProfile, context.trainingExperience);
    const frequencyAssessment = assessFrequency(frequency.distribution, split.sessionsPerWeek, goalProfile);

    const exposureByGroup = muscleGroupExposure(resolved.catalog, volume);
    const rolesInPlan = roleCounts(resolved.catalog, sessions);
    const alignment = evaluateGoalAlignment(goalContext, exposureByGroup, rolesInPlan);

    // Constraints: explicit SATISFIED / VIOLATED / WARNING (Part 15).
    const constraints: PlanConstraintInput[] = [
      ...evaluateConstraints({
        sessions,
        context,
        preferences: resolved.preferences,
        volumeUnderTarget: volume.underTargetMuscles,
        volumeExcessive: volume.potentiallyExcessiveMuscles,
        splitSessions: split.sessionsPerWeek,
      }),
    ];

    // Phase 3.1: an environment-adapted plan states what the environment did to
    // it — how many exercises were substituted and which stimulus is expected
    // to fall short. None of that is silently folded into "feasible".
    if (command.environment) {
      const environment = command.environment;
      const unfillable = sessions.filter((session) => session.exercises.length === 0);
      constraints.push({
        constraintKey: "environment_equipment",
        kind: "environment",
        label: `Every session is performable with the ${environment.kind} equipment universe`,
        isHard: true,
        result: unfillable.length === 0 ? "satisfied" : "violated",
        ...(unfillable.length > 0
          ? {
              violationDetail: `Session(s) ${unfillable
                .map((session) => session.name)
                .join(", ")} have no performable exercise in a ${environment.kind} environment.`,
            }
          : {}),
      });
      constraints.push({
        constraintKey: "environment_substitution",
        kind: "environment",
        label: "Environment-driven substitutions are explicit and honesty-labelled",
        isHard: false,
        result: allSubstitutions.length === 0 ? "satisfied" : "warning",
        ...(allSubstitutions.length > 0
          ? {
              warningDetail: `${allSubstitutions.length} exercise(s) substituted for a ${environment.kind} environment: ${allSubstitutions
                .map(
                  (item) =>
                    `${item.originalExerciseName} → ${item.replacementExerciseName} (${item.equivalence})`,
                )
                .join("; ")}`,
            }
          : {}),
      });
      constraints.push({
        constraintKey: "environment_limitations",
        kind: "environment",
        label: "Stimulus the environment cannot reproduce is stated, never hidden",
        isHard: false,
        result: allLimitations.length === 0 ? "satisfied" : "warning",
        ...(allLimitations.length > 0
          ? {
              warningDetail: allLimitations
                .map((item) => `${item.kind}/${item.subject}: ${item.description}`)
                .join(" "),
            }
          : {}),
      });
    }

    const hardViolations = constraints
      .filter((constraint) => constraint.isHard && constraint.result === "violated")
      .map((constraint) => `${constraint.constraintKey}: ${constraint.violationDetail ?? constraint.label}`);

    const quality = evaluatePlanQuality(
      {
        goalAlignment: alignment.alignmentScore * 100,
        muscleCoverage: coverageScore(volume),
        volumeAppropriateness: scoreFromAssessment(
          volumeAssessment.issues.length,
          volumeAssessment.warnings.length,
        ),
        frequencyAppropriateness: frequencyAssessment.isAppropriate ? 100 : 70,
        equipmentFeasibility: constraints.some(
          (constraint) =>
            constraint.constraintKey === "exercise_availability" && constraint.result === "violated",
        )
          ? 0
          : 100,
        preferenceCompatibility: constraints.some(
          (constraint) => constraint.constraintKey === "excluded_exercises" && constraint.result === "violated",
        )
          ? 0
          : 100,
        sessionDuration: sessions.every((session) => !session.exceedsBudget)
          ? 100
          : scoreSessionDuration(
              true,
              Math.max(
                ...sessions.map((session) => session.estimatedMinutes - session.targetMinutes),
              ),
            ),
        constraintSatisfaction:
          (constraints.filter((constraint) => constraint.result === "satisfied").length /
            Math.max(1, constraints.length)) *
          100,
      },
      { hardViolations },
    );

    const feasibility: GeneratePlanResult["feasibility"] =
      hardViolations.length > 0
        ? // A budget overrun is a tradeoff; anything else (an empty session, a
          // missing exercise universe) is infeasibility. A concurrent duration
          // violation must NEVER downgrade a hard violation of another
          // constraint — that is how an empty-session plan would slip through
          // as "feasible" (Phase 3.1 §16–§18).
          hardViolations.every((violation) => violation.startsWith("session_duration:"))
            ? "feasible_with_tradeoffs"
            : "infeasible"
        : constraints.some((constraint) => constraint.result === "warning")
          ? "feasible_with_tradeoffs"
          : "feasible";

    if (feasibility === "infeasible") {
      return {
        feasibility,
        infeasibilityReasons: hardViolations,
        warnings,
      };
    }

    const generationReason: PlanGenerationReason =
      command.generationReason ?? (command.planId ? "plan_adjustment" : "initial_plan");

    const environmentNote = command.environment
      ? ` Environment: ${command.environment.kind}. ${command.environment.limitations.map((item) => item.description).join(" ")}`
      : "";

    const versionInput: PlanVersionInput = {
      startsOn: command.asOf,
      rationaleNotes: `${split.rationale} ${split.selectionJustification}${environmentNote}`.trim(),
      generationReason,
      configVersion: TRAINING_CONFIG_VERSION,
      sessions: sessions.map((session) => ({
        name: session.name,
        weekdayHint: session.weekdayHint,
        slots: session.exercises.map((exercise) => ({
          exerciseId: exercise.exerciseId,
          targetSets: exercise.targetSets,
          ...(exercise.repMin !== undefined ? { repMin: exercise.repMin } : {}),
          ...(exercise.repMax !== undefined ? { repMax: exercise.repMax } : {}),
          ...(exercise.targetRir !== undefined ? { targetRir: exercise.targetRir } : {}),
          ...(exercise.restSeconds !== undefined ? { restSeconds: exercise.restSeconds } : {}),
          substitutionExerciseIds: exercise.substitutionExerciseIds,
          notes: exercise.planRole,
        })),
      })),
    };

    // `addVersion` returns the new version while `create` returns the whole
    // aggregate; keep the two shapes apart instead of guessing afterwards.
    let plan: PlanAggregate;
    let version: PlanVersionRecord;
    if (command.planId) {
      version = await this.repos.trainingPlans.addVersion(command.planId, versionInput);
      const reloaded = await this.repos.trainingPlans.findById(command.planId);
      if (!reloaded) throw new NotFoundError(`training plan ${command.planId} not found`);
      plan = reloaded;
    } else {
      const created = await this.repos.trainingPlans.create({
        userId,
        name: command.name ?? `${goalContext.goalKind} plan ${command.asOf}`,
        status: "active",
        ...(command.planKind ? { kind: command.planKind } : {}),
        ...(command.environment ? { environmentKind: command.environment.kind } : {}),
        ...(command.effectiveUntil ? { effectiveUntil: command.effectiveUntil } : {}),
        ...(command.temporaryForVersionId
          ? { temporaryForVersionId: command.temporaryForVersionId }
          : {}),
        version: versionInput,
      });
      const latest = latestVersion(created);
      if (!latest) throw new NotFoundError("plan version disappeared after create");
      plan = created;
      version = latest;
    }

    const constraintRecords = await this.repos.trainingPlans.replaceConstraints(
      version.id,
      constraints,
    );

    await this.attachProgressionRules(version, goalProfile, command.environment);

    let decision: PlanDecisionRecord | undefined;
    if (generationReason !== "initial_plan") {
      decision = await this.repos.trainingPlans.recordDecision({
        versionId: version.id,
        decision: decisionKindForReason(generationReason),
        reasonCodes: ["GOAL_ALIGNMENT", "MUSCLE_COVERAGE", "SESSION_DURATION"],
        evidence: version.rationaleNotes ?? split.rationale,
        satisfiedConstraints: constraintRecords
          .filter((constraint) => constraint.result === "satisfied")
          .map((constraint) => constraint.constraintKey),
        violatedConstraints: constraintRecords
          .filter((constraint) => constraint.result === "violated")
          .map((constraint) => constraint.constraintKey),
        affectedMuscles: Object.keys(volume.byMuscle.reduce<Record<string, true>>((acc, entry) => {
          acc[entry.muscleSlug] = true;
          return acc;
        }, {})),
        beforeSnapshot: undefined,
        afterSnapshot: planSummaryFor(version),
        configVersion: TRAINING_CONFIG_VERSION,
      });
    }

    return {
      feasibility,
      infeasibilityReasons: [],
      plan: plan as PlanAggregate,
      version,
      split,
      sessions,
      volume,
      quality: { ...quality, totalScore: quality.total ?? 0 },
      constraints: constraintRecords,
      ...(decision ? { decision } : {}),
      ...(command.environment
        ? {
            environment: command.environment,
            substitutions: allSubstitutions,
            limitations: allLimitations,
            progressionMechanisms: environmentProgressionMechanisms(command.environment),
          }
        : {}),
      warnings,
    };
  }

  // -------------------------------------------------------------------------
  // Phase 3.1 — temporary environment-adapted plans (§15, §21, §22)
  // -------------------------------------------------------------------------

  /**
   * Generate a TEMPORARY plan for the environment in force, adapted from the
   * user's primary (gym) plan.
   *
   * Guarantees:
   *   - the primary plan is never modified or replaced (§21);
   *   - the temporary plan records the version it was adapted from, so
   *     "return to gym" can point back at it (§22);
   *   - when the environment restricts nothing, NO plan is created and the
   *     reason is returned — generating a duplicate of the gym plan would be
   *     noise, not adaptation.
   */
  async generateTemporaryPlan(
    userId: string,
    command: Omit<
      PlanGenerationCommand,
      "planId" | "environment" | "planKind" | "temporaryForVersionId" | "effectiveUntil"
    > & {
      environment?: TrainingEnvironment;
      /** Inclusive last day; defaults to the environment period's end - 1. */
      effectiveUntil?: CalendarDate;
    },
  ): Promise<TemporaryPlanResult> {
    const environment =
      command.environment ?? (await this.resolveActiveEnvironment(userId, command.asOf));
    if (!environment) {
      return {
        environment: null as unknown as TrainingEnvironment,
        needed: false,
        reason: "No training environment could be resolved for this user.",
      };
    }

    if (!environment.constrained) {
      return {
        environment,
        needed: false,
        reason: `The ${environment.kind} environment withholds nothing the user normally trains with; the existing plan already applies.`,
      };
    }

    const primary = await this.repos.trainingPlans.findActive(userId);
    const sourceVersion = primary?.versions.at(-1);
    if (!primary || !sourceVersion) {
      return {
        environment,
        needed: false,
        reason: "No active primary training plan exists to adapt; generate a primary plan first.",
      };
    }

    // A temporary plan is ALWAYS bounded (§19): it either follows the declared
    // environment window, or — when the environment is open-ended — it runs for
    // a finite default adaptation window. An unbounded "temporary" row is
    // rejected by the schema, and rightly so: "temporary" must expire.
    const effectiveUntil =
      command.effectiveUntil ??
      (environment.effectiveTo
        ? previousDay(environment.effectiveTo)
        : plusDays(command.asOf, DEFAULT_TEMPORARY_PLAN_DAYS - 1));

    // Idempotency: a repeated request for the same environment window refreshes
    // the SAME temporary plan instead of spawning a parallel one, so a client
    // retry can never leave the user with two competing home plans (§19). The
    // primary plan is still never touched.
    const existingTemporary = (
      await this.repos.trainingPlans.listTemporary(userId)
    ).find(
      (plan) =>
        plan.status === "active" &&
        plan.temporaryForVersionId === sourceVersion.id &&
        plan.environmentKind === environment.kind &&
        plan.versions.at(-1)?.startsOn === command.asOf,
    );

    const result = await this.generatePlan(userId, {
      ...command,
      ...(existingTemporary ? { planId: existingTemporary.id } : {}),
      name: command.name ?? `${environment.kind} plan ${command.asOf}`,
      environment,
      planKind: "temporary_environment",
      temporaryForVersionId: sourceVersion.id,
      ...(effectiveUntil ? { effectiveUntil } : {}),
      // A temporary plan is an environment substitution of the primary plan,
      // never an "initial" plan — the decision row says so.
      generationReason: command.generationReason ?? "exercise_substitution",
    });

    return {
      environment,
      needed: true,
      sourcePlanId: primary.id,
      sourceVersionId: sourceVersion.id,
      result,
    };
  }

  // -------------------------------------------------------------------------
  // Adaptation
  // -------------------------------------------------------------------------

  async adaptPlan(
    userId: string,
    planId: string,
    options?: { asOf?: CalendarDate },
  ): Promise<AdaptPlanResult> {
    const plan = await this.requireOwnedPlan(userId, planId);
    const version = plan.versions.at(-1);
    if (!version) throw new NotFoundError(`training plan ${planId} has no version`);
    const asOf = options?.asOf ?? version.startsOn;

    const resolved = await this.resolveContext(userId, { asOf });
    const { goalContext, goalProfile, context } = resolved;

    const { plannedVolume } = weeklyVolumeFromVersion(version, resolved.catalog);
    const volume = generateWeeklyVolumeReport(
      resolved.catalog,
      plannedVolume,
      goalProfile,
      context.trainingExperience,
    );

    const performance = await this.exercisePerformance(userId);
    const signals = detectPlateauSignals([], performance, undefined);

    const decision = makeAdaptationDecision(
      planSummaryFor(version),
      volume,
      signals,
      context,
      goalContext,
    );

    const mappedReason = generationReasonForOutcome(decision.outcome);

    // Smallest useful change: `no_change` (and structural outcomes the current
    // generator cannot apply on its own) never mutate historical versions.
    if (!mappedReason) {
      const recorded = await this.repos.trainingPlans.recordDecision({
        versionId: version.id,
        decision: decision.outcome,
        reasonCodes: ["NO_CHANGE_BECAUSE_PROGRESSING"],
        evidence: decision.rationale,
        affectedMuscles: decision.changes.flatMap((change) => change.affectedMuscles ?? []),
        affectedExercises: decision.changes.flatMap((change) => change.affectedExercises ?? []),
        afterSnapshot: planSummaryFor(version),
        configVersion: TRAINING_CONFIG_VERSION,
      });
      return {
        outcome: decision.outcome,
        rationale: decision.rationale,
        smallestUsefulChangeJustification:
          decision.smallestUsefulChangeJustification ?? "",
        triggeringSignals: decision.triggeringSignals,
        decision: recorded,
        monitoringPlan: decision.monitoringPlan ?? [],
      };
    }

    // Apply the intervention by regenerating the next version.
    const adjustments: readonly VolumeAdjustment[] =
      decision.outcome === "adjust_volume"
        ? recommendVolumeAdjustments(
            volume,
            { adherence: 1 },
            goalProfile,
            context.trainingExperience,
          ).adjustments.filter((adjustment) => adjustment.direction === "increase")
        : decision.outcome === "reduce_training_stress"
          ? stressReduction(volume, goalProfile, context.trainingExperience)
          : [];

    const previousVersion = version;
    const generated = await this.generatePlan(userId, {
      planId,
      asOf,
      generationReason: mappedReason,
      goalKind: goalContext.goalKind as GoalKind,
      priorities: goalContext.priorities,
      availableTrainingDays: context.availableTrainingDays,
      maxSessionDurationMinutes: context.maxSessionDurationMinutes,
      experience: context.trainingExperience,
      equipmentIds: context.availableEquipmentIds,
      ...(adjustments.length > 0 ? { volumeAdjustments: adjustments } : {}),
    });

    if (!generated.version || !generated.plan) {
      throw new ConstraintValidationError(
        `intervention ${decision.outcome} could not be applied: ${generated.infeasibilityReasons.join("; ")}`,
      );
    }

    const comparison = comparePlans(
      planSummaryFor(previousVersion),
      planSummaryFor(generated.version),
      volume,
      generated.volume ?? volume,
    );

    const recorded = await this.repos.trainingPlans.recordDecision({
      versionId: generated.version.id,
      decision: decision.outcome,
      reasonCodes: ["PROGRESSION_CONTINUITY", "MUSCLE_COVERAGE", "VOLUME_ADJUSTMENT"],
      evidence: decision.rationale,
      satisfiedConstraints: (generated.constraints ?? [])
        .filter((constraint) => constraint.result === "satisfied")
        .map((constraint) => constraint.constraintKey),
      violatedConstraints: (generated.constraints ?? [])
        .filter((constraint) => constraint.result === "violated")
        .map((constraint) => constraint.constraintKey),
      affectedMuscles: decision.changes.flatMap((change) => change.affectedMuscles ?? []),
      affectedExercises: decision.changes.flatMap((change) => change.affectedExercises ?? []),
      beforeSnapshot: planSummaryFor(previousVersion),
      afterSnapshot: planSummaryFor(generated.version),
      configVersion: TRAINING_CONFIG_VERSION,
    });

    return {
      outcome: decision.outcome,
      rationale: decision.rationale,
      smallestUsefulChangeJustification:
        decision.smallestUsefulChangeJustification ?? "",
      triggeringSignals: decision.triggeringSignals,
      decision: recorded,
      newVersion: generated.version,
      comparisonSummary: summarizePlanComparison(comparison),
      monitoringPlan: decision.monitoringPlan ?? [],
    };
  }

  // -------------------------------------------------------------------------
  // Reads: version, comparison, decisions, constraints, coverage, progression
  // -------------------------------------------------------------------------

  /**
   * Ownership-checked plan read. Phase 1's plan route had no user scope; this
   * is the accessor it now uses, so a plan id alone never leaks another user's
   * training history.
   */
  async getPlanForUser(userId: string, planId: string): Promise<PlanAggregate> {
    return this.requireOwnedPlan(userId, planId);
  }

  async getVersion(
    userId: string,
    planId: string,
    versionNumber: number,
  ): Promise<{ plan: PlanAggregate; version: PlanVersionRecord }> {
    const plan = await this.requireOwnedPlan(userId, planId);
    const version = plan.versions.find((candidate) => candidate.versionNumber === versionNumber);
    if (!version) throw new NotFoundError(`plan version ${versionNumber} not found`);
    return { plan, version };
  }

  async compareVersions(
    userId: string,
    planId: string,
    fromVersionNumber: number,
    toVersionNumber: number,
  ) {
    const { plan } = await this.getVersion(userId, planId, fromVersionNumber);
    const from = plan.versions.find((candidate) => candidate.versionNumber === fromVersionNumber);
    const to = plan.versions.find((candidate) => candidate.versionNumber === toVersionNumber);
    if (!from || !to) throw new NotFoundError("one or both plan versions not found");

    const resolved = await this.resolveContext(userId, { asOf: to.startsOn });
    const goalProfile = resolved.goalProfile;
    const fromVolume = generateWeeklyVolumeReport(
      resolved.catalog,
      weeklyVolumeFromVersion(from, resolved.catalog).plannedVolume,
      goalProfile,
      resolved.context.trainingExperience,
    );
    const toVolume = generateWeeklyVolumeReport(
      resolved.catalog,
      weeklyVolumeFromVersion(to, resolved.catalog).plannedVolume,
      goalProfile,
      resolved.context.trainingExperience,
    );
    const comparison = comparePlans(planSummaryFor(from), planSummaryFor(to), fromVolume, toVolume);
    return { comparison, summary: summarizePlanComparison(comparison) };
  }

  async listDecisions(userId: string, planId: string, versionNumber?: number) {
    const plan = await this.requireOwnedPlan(userId, planId);
    const version =
      versionNumber === undefined
        ? plan.versions.at(-1)
        : plan.versions.find((candidate) => candidate.versionNumber === versionNumber);
    if (!version) throw new NotFoundError("plan version not found");
    return this.repos.trainingPlans.listDecisions(version.id);
  }

  async listConstraints(userId: string, planId: string, versionNumber?: number) {
    const plan = await this.requireOwnedPlan(userId, planId);
    const version =
      versionNumber === undefined
        ? plan.versions.at(-1)
        : plan.versions.find((candidate) => candidate.versionNumber === versionNumber);
    if (!version) throw new NotFoundError("plan version not found");
    return this.repos.trainingPlans.listConstraints(version.id);
  }

  async getCoverage(userId: string, planId: string, versionNumber?: number) {
    const plan = await this.requireOwnedPlan(userId, planId);
    const version =
      versionNumber === undefined
        ? plan.versions.at(-1)
        : plan.versions.find((candidate) => candidate.versionNumber === versionNumber);
    if (!version) throw new NotFoundError("plan version not found");

    const resolved = await this.resolveContext(userId, { asOf: version.startsOn });
    const { plannedVolume } = weeklyVolumeFromVersion(version, resolved.catalog);
    const volume = generateWeeklyVolumeReport(
      resolved.catalog,
      plannedVolume,
      resolved.goalProfile,
      resolved.context.trainingExperience,
    );
    const assessment = assessVolumeAppropriateness(
      volume,
      resolved.goalProfile,
      resolved.context.trainingExperience,
    );
    return { volume, assessment };
  }

  async getProgression(userId: string, planId: string, versionNumber?: number) {
    const plan = await this.requireOwnedPlan(userId, planId);
    const version =
      versionNumber === undefined
        ? plan.versions.at(-1)
        : plan.versions.find((candidate) => candidate.versionNumber === versionNumber);
    if (!version) throw new NotFoundError("plan version not found");

    const resolved = await this.resolveContext(userId, { asOf: version.startsOn });
    const performance = await this.exercisePerformance(userId);
    const rules = await this.repos.trainingPlans.listProgressionRules(version.id);

    const recommendations: {
      exerciseId: string;
      action: string;
      shouldProgress: boolean;
      reasoning: string;
      evidence: readonly string[];
      status: ProgressionStatus;
    }[] = [];

    for (const session of version.sessions) {
      for (const slot of session.slots) {
        const knowledge = resolved.catalog.find((item) => item.id === slot.exerciseId);
        const name = knowledge?.name ?? slot.exerciseId;
        const observed = performance[slot.exerciseId] ?? {
          completedSessions: 0,
          incompleteSessions: 0,
        };
        const evaluation = evaluateProgression(
          slot.exerciseId,
          name,
          observed,
          resolved.goalProfile,
        );
        recommendations.push({
          exerciseId: slot.exerciseId,
          action: evaluation.action,
          shouldProgress: evaluation.shouldProgress,
          reasoning: evaluation.reasoning,
          evidence: evaluation.evidence,
          status: computeStatus(slot.exerciseId, name, observed),
        });
      }
    }

    return { recommendations, rules };
  }

  async getTrainingState(userId: string): Promise<TrainingState> {
    const plan = await this.repos.trainingPlans.findActive(userId);
    const version = plan?.versions.at(-1);
    const goal = await this.repos.goals.active(userId);
    if (!plan || !version) {
      return {
        currentPlanVersionId: null,
        currentPlanStatus: null,
        trainingGoalKind: goal?.kind ?? null,
      };
    }

    const resolved = await this.resolveContext(userId, { asOf: version.startsOn });
    const { plannedVolume, plannedSetsPerMuscle } = weeklyVolumeFromVersion(
      version,
      resolved.catalog,
    );
    const volume = generateWeeklyVolumeReport(
      resolved.catalog,
      plannedVolume,
      resolved.goalProfile,
      resolved.context.trainingExperience,
    );
    const performance = await this.exercisePerformance(userId);
    const signals = detectPlateauSignals([], performance, undefined);
    const constraints = await this.repos.trainingPlans.listConstraints(version.id);
    const decisions = await this.repos.trainingPlans.listDecisions(version.id);
    const ledger = await this.loadLedger(userId);
    const completedProgressions = countCompletedProgressions(ledger);
    const ledgerByExercise = new Map<string, ProgressionLedgerEntry[]>();
    for (const entry of [...ledger].sort(compareLedgerEntries)) {
      const bucket = ledgerByExercise.get(entry.evaluation.exerciseId) ?? [];
      bucket.push(entry);
      ledgerByExercise.set(entry.evaluation.exerciseId, bucket);
    }
    const continuity = await this.continuityFacts(userId, version);
    const environment = await this.resolveActiveEnvironment(userId, version.startsOn);

    const progressionStatus: Record<string, ProgressionStatus> = {};
    const distribution: NonNullable<TrainingState["exerciseDistribution"]>[number][] = [];
    const catalogById = new Map(resolved.catalog.map((entry) => [entry.id, entry]));
    const perExercise = new Map<string, { sessions: number; sets: number; name: string }>();
    for (const session of version.sessions) {
      for (const slot of session.slots) {
        const entry = perExercise.get(slot.exerciseId) ?? {
          sessions: 0,
          sets: 0,
          name: slot.exerciseId,
        };
        entry.sessions += 1;
        entry.sets += slot.targetSets ?? 0;
        perExercise.set(slot.exerciseId, entry);
      }
    }
    for (const [exerciseId, entry] of perExercise) {
      const knowledge = catalogById.get(exerciseId);
      const name = knowledge?.name ?? entry.name;
      distribution.push({
        exerciseId,
        exerciseName: name,
        sessionsPerWeek: entry.sessions,
        totalWeeklySets: entry.sets,
        primaryMuscles: [
          ...new Set(
            (knowledge?.targets ?? [])
              .filter(
                (target) => target.structureId === undefined && target.role === "primary_mover",
              )
              .map((target) => target.muscleSlug),
          ),
        ],
      });
      const observed = performance[exerciseId] ?? { completedSessions: 0, incompleteSessions: 0 };
      const entries = ledgerByExercise.get(exerciseId) ?? [];
      progressionStatus[exerciseId] = computeStatus(exerciseId, name, observed, {
        completed: completedProgressions[exerciseId] ?? 0,
        entries,
      });
    }

    return {
      currentPlanVersionId: version.id,
      currentPlanStatus: plan.status,
      trainingGoalKind: resolved.goalContext.goalKind,
      weeklySessionFrequency: version.sessions.length,
      sessionFrequencyPerWeek: version.sessions.length,
      plannedWeeklyVolumePerMuscle: plannedSetsPerMuscle,
      effectiveWeeklyVolumePerMuscle: volume.byMuscle.reduce<Record<string, number>>(
        (accumulator, entry) => {
          accumulator[entry.muscleSlug] = entry.totalEffectiveSets;
          return accumulator;
        },
        {},
      ),
      exerciseDistribution: distribution,
      progressionStatus,
      plateauSignals: signals,
      constraintViolations: constraints
        .filter((constraint) => constraint.result === "violated")
        .map((constraint) => `${constraint.constraintKey}: ${constraint.label}`),
      recentChanges: decisions.slice(-5).map((decision) => ({
        kind: decision.decision as never,
        description: decision.evidence,
        reason: decision.evidence,
      })),
      confidence: 1,
      ...(environment ? { environment } : {}),
      ...(environment ? { availableEquipmentIds: environment.availableEquipmentIds } : {}),
      ...(environment && environment.limitations.length > 0
        ? { temporaryConstraints: environment.limitations }
        : {}),
      environmentChanges: await this.environmentHistory(userId),
      performanceHistory: Object.fromEntries(
        Object.entries(performance).map(([exerciseId, item]) => [
          exerciseId,
          toPerformanceSummary(exerciseId, item),
        ]),
      ),
      progressionRecommendations: ledger
        .filter((entry) => entry.decision === "recommended")
        .map((entry) => entry.evaluation.recommendation),
      completedProgressions,
      adaptedSessions: continuity.adaptedSessions,
      missedSessions: continuity.missedSessions,
      homeSessions: continuity.homeSessions,
    };
  }

  // -------------------------------------------------------------------------
  // Phase 3.1 — environment + ledger reads (defensive: a repository bundle may
  // predate these repositories, in which case the read model degrades instead
  // of throwing).
  // -------------------------------------------------------------------------

  private async resolveActiveEnvironment(
    userId: string,
    asOf: CalendarDate,
  ): Promise<TrainingEnvironment | null> {
    const repo = this.repos.trainingEnvironments;
    if (!repo) return null;
    const periods = await repo.listPeriods(userId);
    const equipmentRows = await this.repos.equipment.listUserEquipment(userId, asOf);
    return resolveTrainingEnvironment({
      asOf,
      periods,
      ownedEquipment: equipmentRows.map((row) => ({ id: row.equipment.id, slug: row.equipment.slug })),
    });
  }

  private async environmentHistory(userId: string) {
    const repo = this.repos.trainingEnvironments;
    if (!repo) return [];
    return repo.listPeriods(userId);
  }

  /** The progression ledger as flattened, decision-aware entries. */
  private async loadLedger(userId: string): Promise<ProgressionLedgerEntry[]> {
    const repo = this.repos.progressionLedger;
    if (!repo) return [];
    const rows = await repo.listLedger(userId, { limit: 200 });
    return rows.map((row) => buildLedgerEntry(row.evaluation, row.events));
  }

  /**
   * Adapted / missed / home session counts. Missed is defined deterministically:
   * the planned sessions of the trailing window minus the sessions actually
   * completed, floored at zero. An adapted session counts as COMPLETED training
   * (it happened) while remaining distinguishable from the planned session.
   */
  private async continuityFacts(
    userId: string,
    version: PlanVersionRecord,
  ): Promise<{ adaptedSessions: number; missedSessions: number; homeSessions: number }> {
    const workouts = await this.repos.workouts.history(userId, { limit: 100 });
    const completed = workouts.filter(
      (aggregate) =>
        aggregate.workout.status === "completed" || aggregate.workout.status === "partial",
    );
    const adaptedSessions = completed.filter(
      (aggregate) => aggregate.workout.sessionClassification === "adapted",
    ).length;
    const homeSessions = completed.filter(
      (aggregate) =>
        aggregate.workout.environmentKind !== undefined &&
        aggregate.workout.environmentKind !== "gym",
    ).length;
    const plannedSessions = version.sessions.length;
    const missedSessions = Math.max(0, plannedSessions - completed.length);
    return { adaptedSessions, missedSessions, homeSessions };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async requireOwnedPlan(userId: string, planId: string): Promise<PlanAggregate> {
    const plan = await this.repos.trainingPlans.findById(planId);
    if (!plan) throw new NotFoundError(`training plan ${planId} not found`);
    if (plan.userId !== userId) {
      // Cross-user access is never permitted, even before auth exists (§41).
      throw new NotFoundError(`training plan ${planId} not found`);
    }
    return plan;
  }

  private async attachProgressionRules(
    version: PlanVersionRecord,
    goalProfile: TrainingGoalProfile,
    environment?: TrainingEnvironment,
  ): Promise<ProgressionRuleRecord[]> {
    const rules: ProgressionRuleRecord[] = [];
    // Without external load, "add weight" is not a rule the environment can
    // satisfy. The rule is rewritten to the rep lever rather than left stating
    // something impossible (§11/§17) — and the rationale says why.
    const loadAvailable = environment
      ? environmentProgressionMechanisms(environment).includes("load")
      : true;
    for (const session of version.sessions) {
      for (const slot of session.slots) {
        const rule = buildProgressionRule(slot.exerciseId, slot.exerciseId, goalProfile);
        const action = loadAvailable ? rule.action : "progress_reps";
        const bounds = loadAvailable
          ? rule.bounds
          : "Reps and effort first; harder variation (leverage, ROM, tempo, unilateral) when reps outgrow the range. No external load available in this environment.";
        const resetBehavior = loadAvailable
          ? rule.resetBehavior
          : "After reaching the rep ceiling, move to a harder variation rather than adding load.";
        const rationale = loadAvailable
          ? rule.rationale
          : `${rule.rationale} External load is unavailable in a ${environment?.kind ?? "constrained"} environment, so progression uses reps, effort and variation instead.`;
        rules.push(
          await this.repos.trainingPlans.setProgressionRule(slot.id, {
            trigger: rule.trigger,
            condition: rule.condition,
            action,
            bounds,
            ...(resetBehavior ? { resetBehavior } : {}),
            rationale,
            configVersion: rule.configurationVersion,
          }),
        );
      }
    }
    return rules;
  }

  /** Deterministic per-exercise performance derived from logged workouts. */
  private async exercisePerformance(userId: string): Promise<Record<string, ExercisePerformance>> {
    const history = await this.repos.workouts.history(userId, { limit: 50 });
    const perExercise = new Map<
      string,
      { completed: number; incomplete: number; bestReps?: number; recentRir?: number; reps: number[] }
    >();

    const completed = history.filter((aggregate) => aggregate.workout.status === "completed");
    for (const aggregate of completed) {
      for (const exercise of aggregate.exercises) {
        const entry =
          perExercise.get(exercise.exerciseId) ??
          { completed: 0, incomplete: 0, reps: [] as number[] };
        const sets = exercise.sets;
        const worked = sets.filter((set) => (set.reps ?? 0) > 0);
        if (worked.length > 0) {
          entry.completed += 1;
          for (const set of worked) {
            if (set.reps !== undefined) {
              entry.bestReps =
                entry.bestReps === undefined ? set.reps : Math.max(entry.bestReps, set.reps);
              entry.reps.push(set.reps);
            }
            if (set.rir !== undefined) entry.recentRir = set.rir;
          }
        } else if (sets.length > 0) {
          entry.incomplete += 1;
        }
        perExercise.set(exercise.exerciseId, entry);
      }
    }

    const performance: Record<string, ExercisePerformance> = {};
    for (const [exerciseId, entry] of perExercise) {
      performance[exerciseId] = {
        ...(entry.bestReps !== undefined ? { bestReps: entry.bestReps } : {}),
        ...(entry.recentRir !== undefined ? { recentRir: entry.recentRir } : {}),
        completedSessions: entry.completed,
        incompleteSessions: entry.incomplete,
        trend: trendOf(entry.reps),
      };
    }
    return performance;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (kept out of the class so they stay trivially testable)
// ---------------------------------------------------------------------------

function latestVersion(plan: PlanAggregate): PlanVersionRecord | undefined {
  return plan.versions.at(-1);
}

/** The last inclusive day of an exclusive-end date window (§13). */
function previousDay(date: CalendarDate): CalendarDate {
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  const base = Number.isNaN(parsed) ? 0 : parsed;
  return new Date(base - 86_400_000).toISOString().slice(0, 10);
}

/** Default length of a temporary plan when the environment has no end date. */
const DEFAULT_TEMPORARY_PLAN_DAYS = 14;

/** `days` later than `date`, as a calendar date. */
function plusDays(date: CalendarDate, days: number): CalendarDate {
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  const base = Number.isNaN(parsed) ? 0 : parsed;
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

function planSummaryFor(version: PlanVersionRecord): PlanSummary {
  const exerciseIds = [
    ...new Set(version.sessions.flatMap((session) => session.slots.map((slot) => slot.exerciseId))),
  ];
  return {
    planVersionId: version.id,
    versionNumber: version.versionNumber,
    exerciseIds,
    sessions: version.sessions.map((session) => ({
      sessionId: session.id,
      date: version.startsOn,
      exerciseCount: session.slots.length,
      estimatedDurationMinutes: 0,
    })),
    totalExercises: version.sessions.reduce((sum, session) => sum + session.slots.length, 0),
    totalSessions: version.sessions.length,
    estimatedWeeklyDurationMinutes: version.sessions.reduce(
      (sum, session) => sum + session.slots.length * 8,
      0,
    ),
  };
}

function weeklyVolumeFromVersion(
  version: PlanVersionRecord,
  catalog: readonly ExerciseKnowledge[],
): {
  plannedVolume: Record<string, number>;
  plannedSetsPerMuscle: Record<string, number>;
  exercisesById: Map<string, string>;
} {
  const plannedVolume: Record<string, number> = {};
  const exercisesById = new Map<string, string>();
  for (const session of version.sessions) {
    for (const slot of session.slots) {
      plannedVolume[slot.exerciseId] = (plannedVolume[slot.exerciseId] ?? 0) + (slot.targetSets ?? 0);
      exercisesById.set(slot.exerciseId, slot.exerciseId);
    }
  }

  // Prescribed (not effective) sets per muscle: an exercise credits each muscle
  // it trains as a whole-muscle primary mover exactly once, so the number stays
  // readable next to the effective-set report instead of double counting heads.
  const catalogById = new Map(catalog.map((exercise) => [exercise.id, exercise]));
  const plannedSetsPerMuscle: Record<string, number> = {};
  for (const [exerciseId, sets] of Object.entries(plannedVolume)) {
    const knowledge = catalogById.get(exerciseId);
    if (!knowledge) continue;
    for (const entry of knowledge.targets) {
      if (entry.role !== "primary_mover" || entry.structureId !== undefined) continue;
      plannedSetsPerMuscle[entry.muscleSlug] =
        (plannedSetsPerMuscle[entry.muscleSlug] ?? 0) + sets;
    }
  }

  return { plannedVolume, plannedSetsPerMuscle, exercisesById };
}

function weekdayHint(dayName: string): number {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const index = days.indexOf(dayName);
  return index >= 0 ? index : 0;
}

function getTrackedMuscleSlugs(): Record<string, true> {
  return {
    pectoralis_major: true,
    deltoid_anterior: true,
    deltoid_lateral: true,
    deltoid_rear: true,
    latissimus_dorsi: true,
    trapezius: true,
    rhomboids: true,
    spinal_erectors: true,
    biceps_brachii: true,
    triceps_brachii: true,
    brachialis: true,
    quadriceps: true,
    hamstrings: true,
    gluteus_maximus: true,
    gluteus_medius: true,
    calves: true,
    abdominals: true,
    obliques: true,
  };
}

/**
 * Tracked (group-level) slug → knowledge-catalog muscle slugs.
 *
 * The volume/frequency configuration speaks in groups ("calves"); the seeded
 * knowledge catalog targets concrete muscles ("gastrocnemius", "soleus").
 * Without this bridge the group slots were silently unfillable against the
 * real catalog. Group slugs that already match the catalog are absent here.
 */
const TRACKED_TO_CATALOG_MUSCLE_SLUGS: Readonly<Record<string, readonly string[]>> = {
  calves: ["gastrocnemius", "soleus"],
  abdominals: ["rectus_abdominis", "transversus_abdominis"],
  deltoid_anterior: ["deltoid_front"],
  deltoid_lateral: ["deltoid_side"],
  rhomboids: ["rhomboid_major", "rhomboid_minor"],
  spinal_erectors: ["erector_spinae"],
};

/**
 * Expand a group-level assignment into the catalog's muscle-level slugs,
 * splitting its sets deterministically (the first muscle takes the remainder).
 * An assignment is only expanded when its own slug has no catalog candidates
 * and at least one mapped muscle does — otherwise it passes through untouched,
 * so a catalog that already uses the group slugs sees no change.
 */
function expandAssignmentsToCatalogMuscles(
  assignments: readonly SessionAssignment[],
  catalogByMuscle: Readonly<Record<string, readonly ExerciseKnowledge[]>>,
): SessionAssignment[] {
  const expanded: SessionAssignment[] = [];
  for (const assignment of assignments) {
    if ((catalogByMuscle[assignment.muscleSlug]?.length ?? 0) > 0) {
      expanded.push(assignment);
      continue;
    }
    const mapped = TRACKED_TO_CATALOG_MUSCLE_SLUGS[assignment.muscleSlug]?.filter(
      (slug) => (catalogByMuscle[slug]?.length ?? 0) > 0,
    );
    if (!mapped || mapped.length === 0) {
      expanded.push(assignment);
      continue;
    }
    const base = Math.floor(assignment.sets / mapped.length);
    let remainder = assignment.sets - base * mapped.length;
    for (const slug of mapped) {
      const sets = base + (remainder > 0 ? 1 : 0);
      remainder -= 1;
      if (sets > 0) expanded.push({ ...assignment, muscleSlug: slug, sets });
    }
  }
  return expanded;
}

function priorityMuscleSlug(priority: string): string | null {
  const map: Record<string, string> = {
    shoulder_width: "deltoid_lateral",
    upper_back: "trapezius",
    lats: "latissimus_dorsi",
    chest_development: "pectoralis_major",
    arm_development: "biceps_brachii",
    leg_development: "quadriceps",
    posterior_chain: "hamstrings",
    core: "abdominals",
  };
  return map[priority] ?? null;
}

function muscleGroupExposure(
  catalog: readonly ExerciseKnowledge[],
  volume: WeeklyVolumeReport,
): Record<string, number> {
  const slugToGroup = new Map<string, MuscleGroup>();
  for (const exercise of catalog) {
    for (const entry of exercise.targets) slugToGroup.set(entry.muscleSlug, entry.muscleGroup);
  }
  const exposure: Record<string, number> = {};
  for (const entry of volume.byMuscle) {
    const group = slugToGroup.get(entry.muscleSlug);
    if (!group) continue;
    exposure[group] = (exposure[group] ?? 0) + entry.totalEffectiveSets;
  }
  return exposure;
}

function roleCounts(
  catalog: readonly ExerciseKnowledge[],
  sessions: readonly SessionPlanView[],
): Record<string, number> {
  const byId = new Map(catalog.map((exercise) => [exercise.id, exercise]));
  const counts: Record<string, number> = {};
  for (const session of sessions) {
    for (const exercise of session.exercises) {
      const knowledge = byId.get(exercise.exerciseId);
      if (!knowledge) continue;
      for (const role of knowledge.roles) counts[role] = (counts[role] ?? 0) + 1;
    }
  }
  return counts;
}

function coverageScore(volume: WeeklyVolumeReport): number {
  if (volume.byMuscle.length === 0) return 0;
  const inRange = volume.byMuscle.length -
    volume.underTargetMuscles.length -
    volume.potentiallyExcessiveMuscles.length;
  return Math.round((Math.max(0, inRange) / volume.byMuscle.length) * 100);
}

function evaluateConstraints(input: {
  sessions: readonly SessionPlanView[];
  context: TrainingContext;
  preferences: Readonly<Record<string, string>>;
  volumeUnderTarget: readonly string[];
  volumeExcessive: readonly string[];
  splitSessions: number;
}): PlanConstraintInput[] {
  const constraints: PlanConstraintInput[] = [];

  constraints.push({
    constraintKey: "days_per_week",
    kind: "schedule",
    label: `Trains ${input.context.availableTrainingDays} day(s) per week`,
    isHard: true,
    result:
      input.splitSessions > 0 && input.splitSessions <= input.context.availableTrainingDays
        ? "satisfied"
        : "violated",
    ...(input.splitSessions > input.context.availableTrainingDays
      ? {
          violationDetail: `Split needs ${input.splitSessions} sessions but only ${input.context.availableTrainingDays} day(s) are available.`,
        }
      : {}),
  });

  // A session with no eligible exercise is not a plan. It is caught here — and
  // therefore reported as infeasible — instead of being persisted as an empty
  // shell that every later reader would have to special-case.
  const emptySessions = input.sessions.filter((session) => session.exercises.length === 0);
  constraints.push({
    constraintKey: "exercise_availability",
    kind: "equipment",
    label: "Every session can be filled with eligible exercises",
    isHard: true,
    result: emptySessions.length === 0 ? "satisfied" : "violated",
    ...(emptySessions.length > 0
      ? {
          violationDetail: `Session(s) ${emptySessions
            .map((session) => session.name)
            .join(", ")} have no eligible exercise for the available equipment.`,
        }
      : {}),
  });

  const overBudget = input.sessions.filter((session) => session.exceedsBudget);
  constraints.push({
    constraintKey: "session_duration",
    kind: "duration",
    label: `Every session fits ${input.context.maxSessionDurationMinutes} minutes`,
    isHard: true,
    result: overBudget.length === 0 ? "satisfied" : "violated",
    ...(overBudget.length > 0
      ? {
          violationDetail: `Session(s) ${overBudget
            .map((session) => `${session.name} (${session.estimatedMinutes}m)`)
            .join(", ")} exceed the budget.`,
        }
      : {}),
  });

  const excludedSelected: string[] = [];
  const dislikedSelected: string[] = [];
  for (const session of input.sessions) {
    for (const exercise of session.exercises) {
      const preference = input.preferences[exercise.exerciseId];
      if (preference === "excluded") excludedSelected.push(exercise.name);
      if (preference === "disliked") dislikedSelected.push(exercise.name);
    }
  }
  constraints.push({
    constraintKey: "excluded_exercises",
    kind: "preference",
    label: "Excluded exercises never appear in the plan",
    isHard: true,
    result: excludedSelected.length === 0 ? "satisfied" : "violated",
    ...(excludedSelected.length > 0
      ? { violationDetail: `Excluded exercise selected: ${excludedSelected.join(", ")}` }
      : {}),
  });
  constraints.push({
    constraintKey: "disliked_exercises",
    kind: "preference",
    label: "Disliked exercises appear only when no alternative exists",
    isHard: false,
    result: dislikedSelected.length === 0 ? "satisfied" : "warning",
    ...(dislikedSelected.length > 0
      ? { warningDetail: `Disliked exercise used: ${dislikedSelected.join(", ")}` }
      : {}),
  });

  constraints.push({
    constraintKey: "volume_range",
    kind: "volume",
    label: "Planned weekly volume stays inside the configured ranges",
    isHard: false,
    result:
      input.volumeUnderTarget.length === 0 && input.volumeExcessive.length === 0
        ? "satisfied"
        : "warning",
    ...(input.volumeUnderTarget.length > 0
      ? { warningDetail: `Under target: ${input.volumeUnderTarget.join(", ")}` }
      : {}),
    ...(input.volumeExcessive.length > 0
      ? {
          warningDetail: `Potentially excessive: ${input.volumeExcessive.join(", ")}`,
        }
      : {}),
  });

  return constraints;
}

function decisionKindForReason(reason: PlanGenerationReason): string {
  switch (reason) {
    case "volume_adjustment":
      return "adjust_volume";
    case "frequency_adjustment":
      return "adjust_frequency";
    case "exercise_substitution":
      return "replace_exercise";
    case "split_adjustment":
      return "revise_split";
    case "progression_adjustment":
      return "modify_progression";
    case "no_change":
      return "no_change";
    default:
      return "adjust_session";
  }
}

function generationReasonForOutcome(outcome: string): PlanGenerationReason | null {
  switch (outcome) {
    case "adjust_volume":
      return "volume_adjustment";
    case "adjust_frequency":
      return "frequency_adjustment";
    case "replace_exercise":
    case "redistribute_exercise":
      return "exercise_substitution";
    case "revise_split":
      return "split_adjustment";
    case "modify_progression":
    case "progress_load":
    case "progress_reps":
      return "progression_adjustment";
    case "adjust_session":
    case "reduce_training_stress":
      return "plan_adjustment";
    default:
      return null;
  }
}

/**
 * Bounded stress reduction: trim the most exposed muscles back toward their
 * preferred range instead of rebuilding the week.
 */
function stressReduction(
  volume: WeeklyVolumeReport,
  goalProfile: TrainingGoalProfile,
  experience: TrainingExperience,
): VolumeAdjustment[] {
  const adjustments: VolumeAdjustment[] = [];
  for (const entry of volume.byMuscle) {
    const target = getMuscleVolumeTarget(entry.muscleSlug, experience, goalProfile);
    if (!target) continue;
    if (entry.totalEffectiveSets > target.preferred) {
      const amount = Math.min(3, Math.round(entry.totalEffectiveSets - target.preferred));
      adjustments.push({
        muscleSlug: entry.muscleSlug,
        direction: "decrease",
        amount,
        rationale: `${entry.muscleSlug} is ${entry.totalEffectiveSets} effective sets/week, above the preferred ${target.preferred}; trimming ${amount} set(s).`,
      });
    }
  }
  return adjustments;
}

function trendOf(reps: readonly number[]): string {
  if (reps.length < 4) return "unknown";
  const half = Math.floor(reps.length / 2);
  const earlier = reps.slice(0, half);
  const recent = reps.slice(half);
  const earlierAverage = earlier.reduce((sum, value) => sum + value, 0) / earlier.length;
  const recentAverage = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  if (recentAverage > earlierAverage * 1.05) return "improving";
  if (recentAverage < earlierAverage * 0.95) return "declining";
  return "stable";
}

/**
 * Progression status, now backed by the Phase 3.1 ledger.
 *
 * `progressionsCompleted` counts only progressions that were recommended,
 * ACCEPTED and then evidenced by a later performance. A recommendation alone
 * is never a completed progression — that was the Phase 3 placeholder bug.
 */
function computeStatus(
  exerciseId: string,
  exerciseName: string,
  performance: ExercisePerformance,
  ledger?: { completed: number; entries: readonly ProgressionLedgerEntry[] },
): ProgressionStatus {
  const evaluation = evaluateProgression(exerciseId, exerciseName, performance, "hypertrophy");
  const entries = ledger?.entries ?? [];
  const latest = entries.at(-1);
  const pending = entries.filter((entry) => entry.decision === "recommended").length;
  const rejected = entries.filter((entry) => entry.decision === "rejected").length;
  const unproven = entries.filter(
    (entry) => entry.decision === "accepted" && !entry.completed,
  ).length;
  const mechanisms = latest?.evaluation.recommendation.mechanisms;

  const status: ProgressionStatus["status"] =
    evaluation.action === "hold"
      ? "holding"
      : latest?.completed
        ? "progressing"
        : evaluation.shouldProgress
          ? "progressing"
          : performance.trend === "declining"
            ? "regressing"
            : "holding";

  return {
    exerciseId,
    exerciseName,
    progressionsCompleted: ledger?.completed ?? 0,
    status,
    nextProgressionTarget: evaluation.reasoning,
    ...(latest ? { latestEvaluation: latest.evaluation.outcome } : {}),
    ...(latest ? { latestDecision: latest.decision } : {}),
    ...(entries.length > 0
      ? {
          recommendationsPending: pending,
          recommendationsRejected: rejected,
          recommendationsUnproven: unproven,
        }
      : {}),
    ...(mechanisms
      ? {
          loadAvailable: mechanisms.includes("load"),
          progressionMechanisms: mechanisms,
        }
      : {}),
  };
}

/** Workout-derived performance reduced to the structured summary shape. */
function toPerformanceSummary(
  exerciseId: string,
  performance: ExercisePerformance,
): ExercisePerformanceSummary {
  return {
    exerciseId,
    completedSets: performance.completedSessions,
    incompleteSessions: performance.incompleteSessions,
    sessionsObserved: performance.completedSessions + performance.incompleteSessions,
    ...(performance.bestReps !== undefined ? { bestReps: performance.bestReps } : {}),
    ...(performance.bestLoadKg !== undefined ? { bestLoadKg: performance.bestLoadKg } : {}),
    ...(performance.recentRir !== undefined ? { latestRir: performance.recentRir } : {}),
    ...(performance.trend !== undefined ? { trend: performance.trend } : {}),
    mechanisms: progressionMechanismsFor(undefined),
  };
}

/** Re-exported for route-level typing without leaking Prisma types. */
export type { PlanQualityEvaluation, WeeklyVolumeReport, GeneratedSplit };

export { generateSplit };
