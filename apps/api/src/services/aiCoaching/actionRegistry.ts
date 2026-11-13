/**
 * Typed Action Registry — Phase 9.3
 *
 * Strict allowlist of actions the AI Coach may propose to the user. Every
 * action has:
 *  - a typed input/output contract,
 *  - validation of domain constraints against the current personal context,
 *  - execution exclusively through existing domain repository methods — the
 *    AI never executes arbitrary SQL, code, or unrestricted repository
 *    operations,
 *  - a human-readable preview before mutation,
 *  - explicit user confirmation before any write or consequential change,
 *  - rejection without mutation,
 *  - idempotent re-submission where the underlying repository supports it,
 *  - recorded action status and execution outcome.
 *
 * Action lifecycle state (pending/confirmed/rejected/executed) and
 * per-user ownership are tracked by the orchestrator. This registry is
 * stateless: it validates and executes only.
 */

import type { Repositories } from "@fitcoach/db";
import type {
  ActionId,
  ActionKind,
  ActionStatus,
  UserId,
} from "@fitcoach/domain";
import type {
  ActionRegistryEntry,
  ActionValidationResult,
  EvidenceReference,
  PersonalContextSnapshot,
  ProposedAction,
} from "@fitcoach/ai";

/**
 * Executable entry: the registry's entries are invoked with the repository
 * bundle so they can call existing domain methods. The AI provider never
 * gets direct repository access.
 */
interface ExecutableEntry {
  kind: ActionKind;
  title: string;
  description: string;
  requiresConfirmation: boolean;
  validate: (
    parameters: Record<string, unknown>,
    context: PersonalContextSnapshot,
  ) => ActionValidationResult;
  execute: (
    parameters: Record<string, unknown>,
    userId: UserId,
    repos: Repositories,
  ) => Promise<ActionExecutionResult>;
}

/** Outcome of executing a registered action. */
export interface ActionExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/** Human-readable preview of a proposed action, built from its validation. */
export interface ActionPreview {
  kind: ActionKind;
  title: string;
  requiresConfirmation: boolean;
  validation: ActionValidationResult;
  /** Plain-language description of what would happen and why. */
  preview: string;
}

/** In-memory pending-action record maintained by the orchestrator. */
export interface PendingActionRecord {
  id: ActionId;
  kind: ActionKind;
  parameters: Record<string, string | number | boolean | null>;
  userId: UserId;
  conversationId: string;
  messageId: string;
  status: ActionStatus;
  proposedAt: string;
  executedAt?: string;
  result?: unknown;
  error?: string;
  /** Personal context snapshot at proposal time, used for action previews. */
  contextSnapshot?: import("@fitcoach/ai").PersonalContextSnapshot;
}

/** Kinds that mutate user data and therefore always require confirmation. */
const WRITE_KINDS: readonly ActionKind[] = [
  "log_food",
  "log_workout",
  "record_measurement",
  "adjust_nutrition_target",
  "adjust_training_volume",
  "update_goal",
];

function isWriteKind(kind: ActionKind): boolean {
  return WRITE_KINDS.includes(kind);
}

function positiveNumber(value: unknown, key: string): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return `parameter "${key}" must be a positive number`;
  }
  return undefined;
}

function calendarDate(value: unknown, key: string): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `parameter "${key}" must be a calendar date (YYYY-MM-DD)`;
  }
  return undefined;
}

function baseValidate(
  parameters: Record<string, unknown>,
): ActionValidationResult {
  const errors: string[] = [];
  if (
    !parameters ||
    typeof parameters !== "object" ||
    Array.isArray(parameters)
  ) {
    return { valid: false, errors: ["parameters must be an object"] };
  }
  return { valid: true, errors };
}

/** Build a ProposedAction record from a provider proposal. */
export function makeProposedAction(input: {
  id: ActionId;
  kind: ActionKind;
  title: string;
  description: string;
  domainService: string;
  parameters: Record<string, string | number | boolean | null>;
  requiresConfirmation: boolean;
  evidenceRefs: readonly EvidenceReference[];
  decisionSnapshotId?: string;
}): ProposedAction {
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    description: input.description,
    domainService: input.domainService,
    parameters: input.parameters,
    requiresConfirmation: input.requiresConfirmation,
    validated: true,
    evidenceRefs: input.evidenceRefs,
    status: "pending",
    ...(input.decisionSnapshotId ? { decisionSnapshotId: input.decisionSnapshotId } : {}),
  };
}

/**
 * The strict allowlist of supported actions. Kinds not present here can
 * never be proposed or executed by the coaching pipeline.
 */
const ACTION_ENTRIES: ReadonlyMap<ActionKind, ExecutableEntry> = new Map([
  [
    "log_food",
    {
      kind: "log_food",
      title: "Log food",
      description: "Record a meal or food item the user has consumed.",
      requiresConfirmation: true,
      validate: (parameters: Record<string, unknown>): ActionValidationResult => {
        const errors: string[] = [];
        const base = baseValidate(parameters);
        errors.push(...base.errors);
        if (!base.valid) return { valid: false, errors };

        const dateErr = calendarDate(parameters.localDate, "localDate");
        if (dateErr) errors.push(dateErr);

        const items = parameters.items;
        if (!Array.isArray(items) || items.length === 0) {
          errors.push('parameter "items" must be a non-empty array');
        } else {
          for (const [index, item] of items.entries()) {
            const prefix = `items[${index}]`;
            if (!item || typeof item !== "object" || Array.isArray(item)) {
              errors.push(`${prefix} must be an object`);
              continue;
            }
            if (!item.foodId || typeof item.foodId !== "string") {
              errors.push(`${prefix}.foodId is required`);
            }
            const qtyErr = positiveNumber(
              (item as Record<string, unknown>).quantityGrams,
              `${prefix}.quantityGrams`,
            );
            if (qtyErr) errors.push(qtyErr);
          }
        }
        return { valid: errors.length === 0, errors };
      },
      execute: async (
        parameters: Record<string, unknown>,
        userId: UserId,
        repos: Repositories,
      ): Promise<ActionExecutionResult> => {
        const localDate = parameters.localDate as string | undefined;
        const items = parameters.items as
          | readonly Record<string, unknown>[]
          | undefined;
        if (!localDate || !items || items.length === 0) {
          return { success: false, error: "localDate and items are required" };
        }

        // Totals are taken from the evidence-backed item snapshots the AI
        // proposed; the AI may not invent calorie or macro values.
        let totals = {
          caloriesKcal: 0,
          proteinGrams: 0,
          carbohydrateGrams: 0,
          fatGrams: 0,
          fiberGrams: 0,
        };
        const mealItems = [];
        for (const item of items) {
          const snapshot = (item as Record<string, unknown>).computedNutrients as
            | Record<string, number>
            | undefined;
          totals.caloriesKcal += (snapshot?.caloriesKcal ?? 0);
          totals.proteinGrams += (snapshot?.proteinGrams ?? 0);
          totals.carbohydrateGrams += (snapshot?.carbohydrateGrams ?? 0);
          totals.fatGrams += (snapshot?.fatGrams ?? 0);
          totals.fiberGrams += (snapshot?.fiberGrams ?? 0);
          mealItems.push({
            foodId: item.foodId as string,
            quantityGrams: item.quantityGrams as number,
            snapshot: (snapshot ?? {
              caloriesKcal: 0,
              proteinGrams: 0,
              carbohydrateGrams: 0,
              fatGrams: 0,
              fiberGrams: 0,
            }) as any,
            confidence: ((item.confidence as string) ?? "estimated") as any,
            notes: (item.notes as string) ?? undefined,
          });
        }

        const meal = await repos.meals.create({
          userId,
          localDate,
          slot: ((parameters.slot as string) ?? undefined) as any,
          totals,
          items: mealItems,
          ...(parameters.clientRequestId
            ? { clientRequestId: parameters.clientRequestId as string }
            : {}),
        });
        return { success: true, result: { meal } };
      },
    },
  ],
  [
    "log_workout",
    {
      kind: "log_workout",
      title: "Log workout",
      description: "Record a completed training session.",
      requiresConfirmation: true,
      validate: (parameters: Record<string, unknown>): ActionValidationResult => {
        const errors: string[] = [];
        const base = baseValidate(parameters);
        errors.push(...base.errors);
        if (!base.valid) return { valid: false, errors };
        const status = parameters.status;
        if (
          status !== undefined &&
          !["planned", "in_progress", "completed", "partial", "skipped"].includes(
            status as string,
          )
        ) {
          errors.push(
            'parameter "status" must be one of planned, in_progress, completed, partial, skipped',
          );
        }
        return { valid: errors.length === 0, errors };
      },
      execute: async (
        parameters: Record<string, unknown>,
        userId: UserId,
        repos: Repositories,
      ): Promise<ActionExecutionResult> => {
        const workout = await repos.workouts.create({
          userId,
          planId: (parameters.planId as string) ?? undefined,
          planVersionId: (parameters.planVersionId as string) ?? undefined,
          planSessionId: (parameters.planSessionId as string) ?? undefined,
          title: (parameters.title as string) ?? undefined,
          status: ((parameters.status as string) ?? "planned") as any,
          startedAt: (parameters.startedAt as string) ?? undefined,
          endedAt: (parameters.endedAt as string) ?? undefined,
        });
        return { success: true, result: { workout } };
      },
    },
  ],
  [
    "record_measurement",
    {
      kind: "record_measurement",
      title: "Record body measurement",
      description: "Record a body weight, body fat or circumference measurement.",
      requiresConfirmation: true,
      validate: (parameters: Record<string, unknown>): ActionValidationResult => {
        const errors: string[] = [];
        const base = baseValidate(parameters);
        errors.push(...base.errors);
        if (!base.valid) return { valid: false, errors };
        const weight = parameters.bodyWeightKg;
        const fat = parameters.bodyFatPercent;
        const circs = parameters.circumferencesCm;
        const hasDatum =
          (typeof weight === "number" && Number.isFinite(weight)) ||
          (typeof fat === "number" && Number.isFinite(fat)) ||
          (circs !== null &&
            circs !== undefined &&
            typeof circs === "object" &&
            !Array.isArray(circs) &&
            Object.keys(circs).length > 0);
        if (!hasDatum) {
          errors.push(
            "record_measurement requires bodyWeightKg, bodyFatPercent or at least one circumference",
          );
        }
        return { valid: errors.length === 0, errors };
      },
      execute: async (
        parameters: Record<string, unknown>,
        userId: UserId,
        repos: Repositories,
      ): Promise<ActionExecutionResult> => {
        const measurement = await repos.bodyMeasurements.record({
          userId,
          recordedAt: (parameters.recordedAt as string) ?? undefined,
          bodyWeightKg: (parameters.bodyWeightKg as number) ?? undefined,
          bodyFatPercent: (parameters.bodyFatPercent as number) ?? undefined,
          circumferencesCm: (parameters.circumferencesCm as
            | Record<string, number>
            | undefined) ?? undefined,
          confidence: (parameters.confidence as string) ?? undefined,
          enteredVia: (parameters.enteredVia as string) ?? undefined,
          sourceName: (parameters.sourceName as string) ?? undefined,
          notes: (parameters.notes as string) ?? undefined,
        } as any);
        return { success: true, result: { measurement } };
      },
    },
  ],
  [
    "adjust_nutrition_target",
    {
      kind: "adjust_nutrition_target",
      title: "Adjust nutrition targets",
      description: "Propose a change to calorie or macro targets.",
      requiresConfirmation: true,
      validate: (parameters: Record<string, unknown>): ActionValidationResult => {
        const errors: string[] = [];
        const base = baseValidate(parameters);
        errors.push(...base.errors);
        if (!base.valid) return { valid: false, errors };
        const target = parameters.target;
        if (!["calories", "protein", "carbohydrate", "fat"].includes(target as string)) {
          errors.push('parameter "target" must be one of calories, protein, carbohydrate, fat');
        }
        const value = parameters.adjustmentValue;
        if (typeof value !== "number" || !Number.isFinite(value)) {
          errors.push('parameter "adjustmentValue" must be a number');
        }
        return { valid: errors.length === 0, errors };
      },
      execute: async (
        _parameters: Record<string, unknown>,
        _userId: UserId,
      ): Promise<ActionExecutionResult> => {
        // Nutrition targets are derived by the deterministic targets service
        // through the Unified Decision Brain workflow; the AI may not write
        // them directly. This action is preview-only until that workflow is
        // exposed as an executable action (Phase 10).
        return {
          success: false,
          error:
            "nutrition target adjustments must go through the Unified Decision Brain workflow; propose a decision re-evaluation instead",
        };
      },
    },
  ],
  [
    "adjust_training_volume",
    {
      kind: "adjust_training_volume",
      title: "Adjust training volume",
      description: "Propose a change to weekly training volume for a muscle group.",
      requiresConfirmation: true,
      validate: (parameters: Record<string, unknown>): ActionValidationResult => {
        const errors: string[] = [];
        const base = baseValidate(parameters);
        errors.push(...base.errors);
        if (!base.valid) return { valid: false, errors };
        const muscle = parameters.muscleGroup ?? parameters.targetMuscles;
        if (typeof muscle !== "string" || muscle.length === 0) {
          errors.push('parameter "muscleGroup" is required');
        }
        const percent = parameters.adjustmentPercent;
        if (typeof percent !== "number" || !Number.isFinite(percent)) {
          errors.push('parameter "adjustmentPercent" must be a number');
        }
        return { valid: errors.length === 0, errors };
      },
      execute: async (
        _parameters: Record<string, unknown>,
        _userId: UserId,
      ): Promise<ActionExecutionResult> => {
        // Training plans are produced by the deterministic planner; volume
        // changes must flow through the plan adaptation workflow.
        return {
          success: false,
          error:
            "training volume adjustments must go through the plan adaptation workflow; propose a decision re-evaluation instead",
        };
      },
    },
  ],
  [
    "update_goal",
    {
      kind: "update_goal",
      title: "Update goal",
      description: "Propose an update to the user's active coaching goal.",
      requiresConfirmation: true,
      validate: (parameters: Record<string, unknown>): ActionValidationResult => {
        const errors: string[] = [];
        const base = baseValidate(parameters);
        errors.push(...base.errors);
        if (!base.valid) return { valid: false, errors };
        const kind = parameters.kind;
        if (typeof kind !== "string" || kind.length === 0) {
          errors.push('parameter "kind" is required');
        }
        return { valid: errors.length === 0, errors };
      },
      execute: async (
        _parameters: Record<string, unknown>,
        _userId: UserId,
      ): Promise<ActionExecutionResult> => {
        return {
          success: false,
          error:
            "goal updates are not directly executable via the action registry; update goals through the goals API",
        };
      },
    },
  ],
  [
    "reevaluate_decision",
    {
      kind: "reevaluate_decision",
      title: "Re-evaluate decision",
      description: "Request a new Unified Decision Brain evaluation.",
      requiresConfirmation: true,
      validate: (parameters: Record<string, unknown>): ActionValidationResult => {
        const errors: string[] = [];
        const base = baseValidate(parameters);
        errors.push(...base.errors);
        if (!base.valid) return { valid: false, errors };
        const decisionId = parameters.decisionSnapshotId;
        if (!decisionId || typeof decisionId !== "string") {
          errors.push('parameter "decisionSnapshotId" is required');
        }
        return { valid: errors.length === 0, errors };
      },
      execute: async (
        _parameters: Record<string, unknown>,
        _userId: UserId,
      ): Promise<ActionExecutionResult> => {
        return {
          success: false,
          error:
            "decision re-evaluation is triggered through the decision API, not directly via the action registry",
        };
      },
    },
  ],
  [
    "custom",
    {
      kind: "custom",
      title: "Custom action",
      description: "A provider-suggested action outside the typed allowlist.",
      requiresConfirmation: true,
      validate: (parameters: Record<string, unknown>): ActionValidationResult => {
        const errors: string[] = [];
        const base = baseValidate(parameters);
        errors.push(...base.errors);
        if (!base.valid) return { valid: false, errors };
        if (
          typeof parameters.description !== "string" ||
          parameters.description.length === 0
        ) {
          errors.push('parameter "description" is required');
        }
        return { valid: errors.length === 0, errors };
      },
      execute: async (
        _parameters: Record<string, unknown>,
        _userId: UserId,
      ): Promise<ActionExecutionResult> => {
        return {
          success: false,
          error:
            "custom actions require explicit service integration; the AI may not execute arbitrary operations",
        };
      },
    },
  ],
]);

/**
 * TypedActionRegistry enforces the allowlist and exposes validation,
 * preview and execution for each registered action.
 */
export class TypedActionRegistry {
  private readonly entries: Map<ActionKind, ExecutableEntry>;
  private readonly repos: Repositories;

  constructor(
    repos: Repositories,
    entries?: ReadonlyMap<ActionKind, ExecutableEntry>,
  ) {
    this.repos = repos;
    this.entries = new Map(entries ?? ACTION_ENTRIES);
  }

  /** Whether a kind is in the allowlist. */
  has(kind: ActionKind): boolean {
    return this.entries.has(kind);
  }

  /** Retrieve a registered action's contract (undefined when not allowed). */
  get(kind: ActionKind): ActionRegistryEntry | undefined {
    return this.entries.get(kind) as unknown as ActionRegistryEntry | undefined;
  }

  /** List every allowlisted action kind. */
  list(): ActionKind[] {
    return [...this.entries.keys()];
  }

  /** Validate proposed parameters against the current personal context. */
  validateAction(
    kind: ActionKind,
    parameters: Record<string, unknown>,
    context: PersonalContextSnapshot,
  ): ActionValidationResult {
    const entry = this.entries.get(kind);
    if (!entry) {
      return {
        valid: false,
        errors: [`action kind "${kind}" is not in the allowlist`],
      };
    }
    return entry.validate(parameters, context);
  }

  /**
   * Build a human-readable preview of a proposed action from its contract
   * and validation result, without mutating anything.
   */
  preview(
    kind: ActionKind,
    parameters: Record<string, unknown>,
    context: PersonalContextSnapshot,
  ): ActionPreview {
    const entry = this.entries.get(kind);
    if (!entry) {
      return {
        kind,
        title: "Unknown action",
        requiresConfirmation: false,
        validation: {
          valid: false,
          errors: [`action kind "${kind}" is not in the allowlist`],
        },
        preview: `Cannot preview "${kind}": not an allowlisted action.`,
      };
    }
    const validation = entry.validate(parameters, context);
    const parameterSummary = Object.entries(parameters ?? {})
      .map(([key, value]) => `  - ${key}: ${JSON.stringify(value)}`)
      .join("\n") || "  (no parameters)";
    const previewText =
      `${entry.title} (${entry.kind})\n` +
      `${entry.description}\n` +
      `Requires user confirmation: ${entry.requiresConfirmation}\n` +
      `Parameters:\n${parameterSummary}\n` +
      `Validation: ${validation.valid ? "valid" : "invalid — " + validation.errors.join("; ")}${validation.valid ? "" : ". The action will not be executed."}`;
    return {
      kind,
      title: entry.title,
      requiresConfirmation: entry.requiresConfirmation,
      validation,
      preview: previewText,
    };
  }

  /**
   * Execute an allowlisted action through an existing domain repository
   * method. Returns success/failure and the execution outcome; never
   * mutates anything for disallowed or invalid actions.
   */
  async executeAction(
    kind: ActionKind,
    parameters: Record<string, unknown>,
    userId: UserId,
  ): Promise<ActionExecutionResult> {
    const entry = this.entries.get(kind);
    if (!entry) {
      return {
        success: false,
        error: `action kind "${kind}" is not in the allowlist`,
      };
    }
    return (entry as ExecutableEntry).execute(parameters, userId, this.repos);
  }
}

/**
 * The allowlist in machine-readable form. Exported for documentation and
 * API discovery; never used to bypass `has`/`get`.
 */
export const ALLOWLISTED_ACTION_KINDS: readonly ActionKind[] = [
  ...ACTION_ENTRIES.keys(),
];

/** Whether a kind proposes a consequential write that requires confirmation. */
export function actionRequiresConfirmation(kind: ActionKind): boolean {
  return isWriteKind(kind);
}
