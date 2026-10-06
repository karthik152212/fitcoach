import { MOVEMENT_PATTERNS } from "@fitcoach/domain";
import type { MovementFunction, Profile } from "@fitcoach/domain";
import { buildExampleUser, createUserSummary } from "./example";
import type { AppServices } from "./services";
import type { Router } from "./http";
import { RouteError } from "./http";
import {
  asObject,
  optionalDate,
  optionalEnum,
  optionalNumber,
  optionalObjectArray,
  optionalPlainObject,
  optionalString,
  optionalStringArray,
  optionalTimestamp,
  optionalUuid,
  requiredDate,
  requiredEnum,
  requiredNumber,
  requiredString,
  requiredUuid,
} from "./validation";

/**
 * API routes (milestone §12). Handlers stay thin: validate the request,
 * build a typed command, call a service, shape the response. Database
 * implementation details never appear in responses — services/repositories
 * already return domain-shaped records.
 */

const GOAL_KINDS = [
  "bodybuilding",
  "aesthetics_v_taper",
  "lean_recomposition",
  "athletic_performance",
  "max_strength",
  "general_fitness",
  "custom",
] as const;

const SEX_VALUES = ["male", "female", "intersex", "undisclosed"] as const;
const EXPERIENCE_VALUES = ["untrained", "beginner", "intermediate", "advanced"] as const;
const UNIT_SYSTEMS = ["metric", "imperial"] as const;

const MEASUREMENT_CONDITIONS = ["morning_fasted", "post_workout", "evening", "random", "other"] as const;
const ENTRY_METHODS = ["manual", "smart_scale_import", "wearable_import", "other"] as const;
const CONFIDENCE_VALUES = ["measured", "label_declared", "estimated", "unknown"] as const;
const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack", "other"] as const;
const SET_KINDS = ["warmup", "working", "drop_set", "rest_pause", "amrap", "failure"] as const;
const WORKOUT_STATUSES = ["planned", "in_progress", "completed", "partial", "skipped"] as const;
const ACTIVITY_KINDS = [
  "steps",
  "walk",
  "run",
  "cycle",
  "row",
  "swim",
  "elliptical",
  "stairs",
  "sport",
  "other",
] as const;
const EFFORT_LEVELS = ["low", "moderate", "high"] as const;
const SEVERITIES = ["informational", "watch", "act", "urgent"] as const;
const DIAGNOSIS_STATUSES = ["open", "monitoring", "resolved", "dismissed"] as const;
const RECOMMENDATION_STATUSES = [
  "presented",
  "acknowledged",
  "acted_on",
  "dismissed",
  "expired",
] as const;
const INTERVENTION_KINDS = [
  "nutrition_target_adjustment",
  "food_choice_guidance",
  "activity_target_adjustment",
  "training_volume_adjustment",
  "exercise_substitution",
  "split_structure_adjustment",
  "progression_scheme_adjustment",
  "measurement_protocol_adjustment",
  "recovery_adjustment",
  "no_change",
  "custom",
] as const;
const INTERVENTION_STATUSES = [
  "proposed",
  "accepted",
  "active",
  "completed",
  "rejected",
  "superseded",
] as const;
const OUTCOME_VERDICTS = [
  "improved_as_expected",
  "no_effect",
  "worsened",
  "uncertain",
  "too_early",
] as const;
const PLAN_STATUSES = ["draft", "active", "paused", "retired"] as const;
const EXERCISE_CATEGORIES = [
  "compound",
  "isolation",
  "conditioning",
  "mobility",
  "other",
] as const;
const EXERCISE_PREFERENCE_KINDS = ["preferred", "neutral", "disliked", "excluded"] as const;
const SUBSTITUTION_TRIGGERS = [
  "generic",
  "equipment_missing",
  "equipment_changed",
  "machine_busy",
  "disliked",
] as const;

const BODY_SITES = [
  "neck",
  "shoulders",
  "chest",
  "waist",
  "hips",
  "left_upper_arm",
  "right_upper_arm",
  "left_thigh",
  "right_thigh",
  "left_calf",
  "right_calf",
] as const;

/**
 * Project query parameters onto a plain object so the shared validation helpers
 * can be reused for GET requests. List-shaped parameters (any key ending in
 * `Ids` or `Slugs`) accept both repeated values and comma-separated values,
 * because both appear in real clients.
 */
function queryToBody(query: URLSearchParams): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of query.entries()) {
    if (key.endsWith("Ids") || key.endsWith("Slugs")) {
      const existing = Array.isArray(body[key]) ? (body[key] as string[]) : [];
      body[key] = [...existing, ...value.split(",").map((item) => item.trim()).filter(Boolean)];
    } else {
      body[key] = value;
    }
  }
  return body;
}

function queryNumber(query: URLSearchParams, key: string, min: number, max: number): number | undefined {
  const raw = query.get(key);
  if (raw === null || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RouteError(400, "validation_failed", `query parameter ${key} must be a number in [${min}, ${max}]`);
  }
  return value;
}

function queryDate(query: URLSearchParams, key: string): string | undefined {
  const raw = query.get(key);
  if (raw === null || raw === "") return undefined;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    throw new RouteError(400, "validation_failed", `query parameter ${key} must be a date or timestamp`);
  }
  return new Date(parsed).toISOString();
}

/** Calendar-day filters (activity): strict YYYY-MM-DD, never a timestamp. */
function queryCalendarDate(query: URLSearchParams, key: string): string | undefined {
  const raw = query.get(key);
  if (raw === null || raw === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new RouteError(400, "validation_failed", `query parameter ${key} must be YYYY-MM-DD`);
  }
  return raw;
}

function queryEnum<T extends string>(query: URLSearchParams, key: string, values: readonly T[]): T | undefined {
  const raw = query.get(key);
  if (raw === null || raw === "") return undefined;
  if (!values.includes(raw as T)) {
    throw new RouteError(400, "validation_failed", `query parameter ${key} must be one of: ${values.join(", ")}`);
  }
  return raw as T;
}

function parseEvidence(body: Record<string, unknown>): Array<{
  metric: string;
  window: string;
  observed: string;
  observedNumeric?: number;
  expected?: string;
}> | undefined {
  const items = optionalObjectArray(body, "evidence", { maxItems: 50 });
  if (!items) return undefined;
  return items.map((item, index) => {
    const metric = requiredString(item, `evidence[${index}].metric`, { maxLength: 200 });
    const window = requiredString(item, `evidence[${index}].window`, { maxLength: 100 });
    const observed = requiredString(item, `evidence[${index}].observed`, { maxLength: 2000 });
    const observedNumeric = optionalNumber(item, `evidence[${index}].observedNumeric`);
    const expected = optionalString(item, `evidence[${index}].expected`, { maxLength: 2000 });
    return {
      metric,
      window,
      observed,
      ...(observedNumeric !== undefined ? { observedNumeric } : {}),
      ...(expected !== undefined ? { expected } : {}),
    };
  });
}

function parseNutrients(body: Record<string, unknown>): {
  caloriesKcal: number;
  proteinGrams: number;
  carbohydrateGrams: number;
  fatGrams: number;
  fiberGrams?: number;
  sugarsGrams?: number;
  saturatedFatGrams?: number;
  sodiumMilligrams?: number;
  alcoholGrams?: number;
} {
  const nutrients = asObject(body["nutrientsPer100g"], "nutrientsPer100g");
  const optional = (key: string): number | undefined => optionalNumber(nutrients, key, { min: 0 });
  return {
    caloriesKcal: requiredNumber(nutrients, "caloriesKcal", { min: 0 }),
    proteinGrams: requiredNumber(nutrients, "proteinGrams", { min: 0 }),
    carbohydrateGrams: requiredNumber(nutrients, "carbohydrateGrams", { min: 0 }),
    fatGrams: requiredNumber(nutrients, "fatGrams", { min: 0 }),
    ...(optional("fiberGrams") !== undefined ? { fiberGrams: optional("fiberGrams") } : {}),
    ...(optional("sugarsGrams") !== undefined ? { sugarsGrams: optional("sugarsGrams") } : {}),
    ...(optional("saturatedFatGrams") !== undefined
      ? { saturatedFatGrams: optional("saturatedFatGrams") }
      : {}),
    ...(optional("sodiumMilligrams") !== undefined ? { sodiumMilligrams: optional("sodiumMilligrams") } : {}),
    ...(optional("alcoholGrams") !== undefined ? { alcoholGrams: optional("alcoholGrams") } : {}),
  };
}

/**
 * Routes that never touch the database (health + placeholder example).
 * Registered regardless of service wiring.
 */
export function registerExampleRoutes(router: Router): void {
  router.add("GET", "/healthz", () => ({ body: { status: "ok" } }));
  router.add("GET", "/v0/example-profile", () => {
    const user = buildExampleUser();
    return { body: { user, summary: createUserSummary(user) } };
  });
}

export function registerRoutes(router: Router, services: AppServices): void {
  // -------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------
  router.add("POST", "/v0/users", async ({ body }) => {
    const email = optionalString(body, "email", { maxLength: 320 });
    const displayName = optionalString(body, "displayName", { maxLength: 200 });
    const timezone = optionalString(body, "timezone", { maxLength: 100 });
    return {
      status: 201,
      body: {
        user: await services.users.create({
          ...(email !== undefined ? { email } : {}),
          ...(displayName !== undefined ? { displayName } : {}),
          ...(timezone !== undefined ? { timezone } : {}),
        }),
      },
    };
  });

  router.add("GET", "/v0/users/:userId", async ({ params }) => ({
    body: { user: await services.users.get(params["userId"]!) },
  }));

  // -------------------------------------------------------------------------
  // Profile
  // -------------------------------------------------------------------------
  router.add("PUT", "/v0/users/:userId/profile", async ({ params, body }) => {
    const userId = params["userId"]!;
    const profile: Profile = {};
    const birthDate = optionalDate(body, "birthDate");
    if (birthDate !== undefined) profile.birthDate = birthDate;
    const sex = optionalEnum(body, "sex", SEX_VALUES);
    if (sex !== undefined) profile.sex = sex;
    const heightCm = optionalNumber(body, "heightCm", { min: 1, max: 300 });
    if (heightCm !== undefined) profile.heightCm = heightCm;
    const experience = optionalEnum(body, "trainingExperience", EXPERIENCE_VALUES);
    if (experience !== undefined) profile.trainingExperience = experience;
    const daysPerWeek = optionalNumber(body, "trainingDaysPerWeek", { min: 0, max: 7, integer: true });
    if (daysPerWeek !== undefined) profile.trainingDaysPerWeek = daysPerWeek;
    const minutes = optionalNumber(body, "sessionDurationMinutes", { min: 1, max: 1440, integer: true });
    if (minutes !== undefined) profile.sessionDurationMinutes = minutes;
    const limitations = optionalStringArray(body, "limitations", { maxItems: 50, maxLength: 500 });
    if (limitations !== undefined) profile.limitations = limitations;
    const unitSystem = optionalEnum(body, "unitSystem", UNIT_SYSTEMS);
    if (unitSystem !== undefined) profile.unitSystem = unitSystem;
    const reason = optionalString(body, "reason", { maxLength: 500 });

    const saved = await services.profiles.upsert(userId, profile, reason);
    return { body: { profile: saved } };
  });

  router.add("GET", "/v0/users/:userId/profile", async ({ params, query }) => {
    const userId = params["userId"]!;
    const profile = await services.profiles.get(userId);
    if (query.get("revisions") === "true") {
      return { body: { profile, revisions: await services.profiles.revisions(userId) } };
    }
    return { body: { profile } };
  });

  // -------------------------------------------------------------------------
  // Goals
  // -------------------------------------------------------------------------
  router.add("POST", "/v0/users/:userId/goals", async ({ params, body }) => {
    const userId = params["userId"]!;
    const kind = requiredEnum(body, "kind", GOAL_KINDS);
    const description = optionalString(body, "description", { maxLength: 2000 });
    const effectiveFrom = optionalDate(body, "effectiveFrom");
    const priorities = optionalStringArray(body, "priorities", { maxItems: 30, maxLength: 100 });
    const physiqueTargetRaw = optionalPlainObject(body, "physiqueTarget");

    let physiqueTarget: Record<string, number | string> | undefined;
    if (physiqueTargetRaw) {
      physiqueTarget = {};
      const numeric = (key: string, min: number, max: number): void => {
        const value = optionalNumber(physiqueTargetRaw, key, { min, max });
        if (value !== undefined) physiqueTarget![key] = value;
      };
      numeric("bodyWeightKg", 1, 500);
      numeric("bodyFatPercent", 0, 60);
      numeric("waistCm", 1, 300);
      numeric("chestCm", 1, 300);
      numeric("shoulderCircumferenceCm", 1, 300);
      numeric("armCm", 1, 100);
      numeric("thighCm", 1, 150);
      numeric("calfCm", 1, 100);
      const notes = optionalString(physiqueTargetRaw, "notes", { maxLength: 2000 });
      if (notes !== undefined) physiqueTarget["notes"] = notes;
    }

    const today = await services.users.localToday(userId);
    const goal = await services.goals.create(
      userId,
      {
        kind,
        ...(description !== undefined ? { description } : {}),
        ...(effectiveFrom !== undefined ? { effectiveFrom } : {}),
        ...(priorities ? { priorities } : {}),
        ...(physiqueTarget
          ? { physiqueTarget: physiqueTarget as never }
          : {}),
      },
      today,
    );
    return { status: 201, body: { goal } };
  });

  router.add("GET", "/v0/users/:userId/goals/active", async ({ params }) => {
    const goal = await services.goals.active(params["userId"]!);
    if (!goal) throw new RouteError(404, "not_found", "no active goal");
    return { body: { goal } };
  });

  router.add("GET", "/v0/users/:userId/goals", async ({ params }) => ({
    body: { goals: await services.goals.history(params["userId"]!) },
  }));

  // -------------------------------------------------------------------------
  // Equipment
  // -------------------------------------------------------------------------
  router.add("POST", "/v0/users/:userId/equipment", async ({ params, body }) => {
    const userId = params["userId"]!;
    const equipmentId = requiredUuid(body, "equipmentId");
    const label = optionalString(body, "label", { maxLength: 200 });
    const validFrom = optionalDate(body, "validFrom");
    const validTo = optionalDate(body, "validTo");
    const specifications = optionalPlainObject(body, "specifications");
    const record = await services.equipment.add(userId, {
      equipmentId,
      ...(label !== undefined ? { label } : {}),
      ...(validFrom !== undefined ? { validFrom } : {}),
      ...(validTo !== undefined ? { validTo } : {}),
      ...(specifications ? { specifications } : {}),
    });
    return { status: 201, body: { equipment: record } };
  });

  router.add("GET", "/v0/users/:userId/equipment", async ({ params, query }) => {
    const at = query.get("at");
    if (at !== null && !/^\d{4}-\d{2}-\d{2}$/.test(at)) {
      throw new RouteError(400, "validation_failed", "query parameter at must be YYYY-MM-DD");
    }
    const list = await services.equipment.list(params["userId"]!, at ?? undefined);
    return { body: { equipment: list } };
  });

  // -------------------------------------------------------------------------
  // Body measurements
  // -------------------------------------------------------------------------
  router.add("POST", "/v0/users/:userId/measurements", async ({ params, body }) => {
    const userId = params["userId"]!;
    const recordedAt = optionalTimestamp(body, "recordedAt");
    const condition = optionalEnum(body, "condition", MEASUREMENT_CONDITIONS);
    const bodyWeightKg = optionalNumber(body, "bodyWeightKg", { min: 1, max: 500 });
    const bodyFatPercent = optionalNumber(body, "bodyFatPercent", { min: 0, max: 60 });
    const enteredVia = optionalEnum(body, "enteredVia", ENTRY_METHODS);
    const confidence = optionalEnum(body, "confidence", ["measured", "estimated", "unknown"] as const);
    const sourceName = optionalString(body, "sourceName", { maxLength: 200 });
    const externalId = optionalString(body, "externalId", { maxLength: 500 });
    const notes = optionalString(body, "notes", { maxLength: 4000 });
    const photoRefs = optionalStringArray(body, "photoRefs", { maxItems: 20, maxLength: 500 });
    const circumferencesRaw = optionalPlainObject(body, "circumferencesCm");

    let circumferences: Record<string, number> | undefined;
    if (circumferencesRaw) {
      circumferences = {};
      for (const [site, value] of Object.entries(circumferencesRaw)) {
        if (!BODY_SITES.includes(site as (typeof BODY_SITES)[number])) {
          throw new RouteError(400, "validation_failed", `circumferencesCm.${site} is not a known body site`);
        }
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 300) {
          throw new RouteError(400, "validation_failed", `circumferencesCm.${site} must be a positive number <= 300`);
        }
        circumferences[site] = value;
      }
    }

    const record = await services.bodyMeasurements.record(userId, {
      ...(recordedAt !== undefined ? { recordedAt } : {}),
      ...(condition ? { condition } : {}),
      ...(bodyWeightKg !== undefined ? { bodyWeightKg } : {}),
      ...(bodyFatPercent !== undefined ? { bodyFatPercent } : {}),
      ...(circumferences ? { circumferencesCm: circumferences } : {}),
      ...(enteredVia ? { enteredVia } : {}),
      ...(confidence ? { confidence } : {}),
      ...(sourceName !== undefined ? { sourceName } : {}),
      ...(externalId !== undefined ? { externalId } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(photoRefs ? { photoRefs } : {}),
    });
    return { status: 201, body: { measurement: record } };
  });

  router.add("GET", "/v0/users/:userId/measurements", async ({ params, query }) => {
    const limit = queryNumber(query, "limit", 1, 500);
    const from = queryDate(query, "from");
    const to = queryDate(query, "to");
    const history = await services.bodyMeasurements.history(params["userId"]!, {
      ...(limit !== undefined ? { limit } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
    });
    return { body: { measurements: history } };
  });

  // -------------------------------------------------------------------------
  // Training plans
  // -------------------------------------------------------------------------
  function parsePlanVersion(body: Record<string, unknown>): {
    startsOn: string;
    endsOn?: string;
    rationaleNotes?: string;
    sessions: Array<{
      name: string;
      weekdayHint?: number;
      slots: Array<{
        exerciseId: string;
        targetSets?: number;
        repMin?: number;
        repMax?: number;
        targetRir?: number;
        restSeconds?: number;
        substitutionExerciseIds?: string[];
        notes?: string;
      }>;
    }>;
  } {
    const startsOn = requiredDate(body, "startsOn");
    const endsOn = optionalDate(body, "endsOn");
    const rationaleNotes = optionalString(body, "rationaleNotes", { maxLength: 2000 });
    const sessionsRaw = optionalObjectArray(body, "sessions", { maxItems: 21 });
    const sessions = (sessionsRaw ?? []).map((session, index) => {
      const name = requiredString(session, `sessions[${index}].name`, { maxLength: 200 });
      const weekdayHint = optionalNumber(session, `sessions[${index}].weekdayHint`, {
        min: 0,
        max: 6,
        integer: true,
      });
      const slotsRaw = optionalObjectArray(session, `sessions[${index}].slots`, { maxItems: 30 });
      if (!slotsRaw || slotsRaw.length === 0) {
        throw new RouteError(400, "validation_failed", `sessions[${index}].slots must be a non-empty array`);
      }
      const slots = slotsRaw.map((slot, slotIndex) => {
        const exerciseId = requiredUuid(slot, `sessions[${index}].slots[${slotIndex}].exerciseId`);
        const targetSets = optionalNumber(slot, `sessions[${index}].slots[${slotIndex}].targetSets`, {
          min: 1,
          max: 100,
          integer: true,
        });
        const repMin = optionalNumber(slot, `sessions[${index}].slots[${slotIndex}].repMin`, {
          min: 0,
          max: 1000,
          integer: true,
        });
        const repMax = optionalNumber(slot, `sessions[${index}].slots[${slotIndex}].repMax`, {
          min: 0,
          max: 1000,
          integer: true,
        });
        if (repMin !== undefined && repMax !== undefined && repMin > repMax) {
          throw new RouteError(400, "validation_failed", `sessions[${index}].slots[${slotIndex}].repMin must be <= repMax`);
        }
        const targetRir = optionalNumber(slot, `sessions[${index}].slots[${slotIndex}].targetRir`, {
          min: 0,
          max: 10,
        });
        const restSeconds = optionalNumber(slot, `sessions[${index}].slots[${slotIndex}].restSeconds`, {
          min: 0,
          max: 7200,
          integer: true,
        });
        const substitutionExerciseIds = optionalStringArray(
          slot,
          `sessions[${index}].slots[${slotIndex}].substitutionExerciseIds`,
          { maxItems: 20 },
        );
        if (substitutionExerciseIds) {
          for (const id of substitutionExerciseIds) {
            if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
              throw new RouteError(400, "validation_failed", "substitution ids must be UUIDs");
            }
          }
        }
        const notes = optionalString(slot, `sessions[${index}].slots[${slotIndex}].notes`, {
          maxLength: 2000,
        });
        return {
          exerciseId,
          ...(targetSets !== undefined ? { targetSets } : {}),
          ...(repMin !== undefined ? { repMin } : {}),
          ...(repMax !== undefined ? { repMax } : {}),
          ...(targetRir !== undefined ? { targetRir } : {}),
          ...(restSeconds !== undefined ? { restSeconds } : {}),
          ...(substitutionExerciseIds ? { substitutionExerciseIds } : {}),
          ...(notes !== undefined ? { notes } : {}),
        };
      });
      return {
        name,
        ...(weekdayHint !== undefined ? { weekdayHint } : {}),
        slots,
      };
    });
    return {
      startsOn,
      ...(endsOn !== undefined ? { endsOn } : {}),
      ...(rationaleNotes !== undefined ? { rationaleNotes } : {}),
      sessions,
    };
  }

  router.add("POST", "/v0/users/:userId/training-plans", async ({ params, body }) => {
    const userId = params["userId"]!;
    const name = requiredString(body, "name", { maxLength: 200 });
    const status = optionalEnum(body, "status", PLAN_STATUSES);
    const notes = optionalString(body, "notes", { maxLength: 4000 });
    const version = parsePlanVersion(body);
    const plan = await services.training.createPlan(userId, {
      name,
      ...(status !== undefined ? { status } : {}),
      ...(notes !== undefined ? { notes } : {}),
      version,
    });
    return { status: 201, body: { plan } };
  });

  router.add("GET", "/v0/users/:userId/training-plans", async ({ params }) => ({
    body: { plans: await services.training.listPlans(params["userId"]!) },
  }));

  router.add("GET", "/v0/users/:userId/training-plans/active", async ({ params }) => {
    const plan = await services.training.getActivePlan(params["userId"]!);
    if (!plan) throw new RouteError(404, "not_found", "no active training plan");
    return { body: { plan } };
  });

  router.add("POST", "/v0/users/:userId/training-plans/:planId/versions", async ({ params, body }) => {
    const version = await services.training.addVersion(params["planId"]!, parsePlanVersion(body));
    return { status: 201, body: { version } };
  });

  router.add("GET", "/v0/users/:userId/training-plans/:planId", async ({ params }) => ({
    body: { plan: await services.training.getPlan(params["planId"]!) },
  }));

  // -------------------------------------------------------------------------
  // Workouts
  // -------------------------------------------------------------------------
  router.add("POST", "/v0/users/:userId/workouts", async ({ params, body }) => {
    const userId = params["userId"]!;
    const planId = optionalUuid(body, "planId");
    const planVersionId = optionalUuid(body, "planVersionId");
    const planSessionId = optionalUuid(body, "planSessionId");
    const title = optionalString(body, "title", { maxLength: 300 });
    const status = optionalEnum(body, "status", WORKOUT_STATUSES);
    const startedAt = optionalTimestamp(body, "startedAt");
    const endedAt = optionalTimestamp(body, "endedAt");
    const notes = optionalString(body, "notes", { maxLength: 4000 });
    const clientRequestId = optionalString(body, "clientRequestId", { maxLength: 200 });
    const workout = await services.training.createWorkout(userId, {
      ...(planId !== undefined ? { planId } : {}),
      ...(planVersionId !== undefined ? { planVersionId } : {}),
      ...(planSessionId !== undefined ? { planSessionId } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...(endedAt !== undefined ? { endedAt } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(clientRequestId !== undefined ? { clientRequestId } : {}),
    });
    return { status: 201, body: { workout } };
  });

  router.add("GET", "/v0/users/:userId/workouts", async ({ params, query }) => {
    const limit = queryNumber(query, "limit", 1, 500);
    const from = queryDate(query, "from");
    const to = queryDate(query, "to");
    const history = await services.training.history(params["userId"]!, {
      ...(limit !== undefined ? { limit } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
    });
    return { body: { workouts: history } };
  });

  router.add(
    "POST",
    "/v0/users/:userId/workouts/:workoutId/exercises",
    async ({ params, body }) => {
      const exerciseId = requiredUuid(body, "exerciseId");
      const position = optionalNumber(body, "position", { min: 0, max: 1000, integer: true });
      const notes = optionalString(body, "notes", { maxLength: 2000 });
      const group = await services.training.recordExercise(params["workoutId"]!, {
        exerciseId,
        ...(position !== undefined ? { position } : {}),
        ...(notes !== undefined ? { notes } : {}),
      });
      return { status: 201, body: { workoutExercise: group } };
    },
  );

  router.add("POST", "/v0/users/:userId/workouts/:workoutId/sets", async ({ params, body }) => {
    const kind = requiredEnum(body, "kind", SET_KINDS);
    const workoutExerciseId = optionalUuid(body, "workoutExerciseId");
    const exerciseId = optionalUuid(body, "exerciseId");
    const position = optionalNumber(body, "position", { min: 0, max: 1000, integer: true });
    const loadKg = optionalNumber(body, "loadKg", { min: 0, max: 1000 });
    const addedLoadKg = optionalNumber(body, "addedLoadKg", { min: 0, max: 1000 });
    const reps = optionalNumber(body, "reps", { min: 0, max: 1000, integer: true });
    const distanceMeters = optionalNumber(body, "distanceMeters", { min: 0, max: 1_000_000 });
    const durationSeconds = optionalNumber(body, "durationSeconds", { min: 0, max: 86_400, integer: true });
    const rir = optionalNumber(body, "rir", { min: 0, max: 10 });
    const rpe = optionalNumber(body, "rpe", { min: 0, max: 10 });
    const notes = optionalString(body, "notes", { maxLength: 2000 });

    const set = await services.training.recordSet(params["workoutId"]!, {
      kind,
      ...(workoutExerciseId !== undefined ? { workoutExerciseId } : {}),
      ...(exerciseId !== undefined ? { exerciseId } : {}),
      ...(position !== undefined ? { position } : {}),
      ...(loadKg !== undefined ? { loadKg } : {}),
      ...(addedLoadKg !== undefined ? { addedLoadKg } : {}),
      ...(reps !== undefined ? { reps } : {}),
      ...(distanceMeters !== undefined ? { distanceMeters } : {}),
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      ...(rir !== undefined ? { rir } : {}),
      ...(rpe !== undefined ? { rpe } : {}),
      ...(notes !== undefined ? { notes } : {}),
    });
    return { status: 201, body: { set } };
  });

  router.add("POST", "/v0/users/:userId/workouts/:workoutId/complete", async ({ params, body }) => {
    const status = optionalEnum(body, "status", ["completed", "partial", "skipped"] as const);
    const endedAt = optionalTimestamp(body, "endedAt");
    const workout = await services.training.complete(params["workoutId"]!, {
      ...(status !== undefined ? { status } : {}),
      ...(endedAt !== undefined ? { endedAt } : {}),
    });
    return { body: { workout } };
  });

  router.add("GET", "/v0/users/:userId/workouts/:workoutId", async ({ params }) => ({
    body: { workout: await services.training.getWorkout(params["workoutId"]!) },
  }));

  // -------------------------------------------------------------------------
  // Activity
  // -------------------------------------------------------------------------
  router.add("POST", "/v0/users/:userId/activity", async ({ params, body }) => {
    const userId = params["userId"]!;
    const kind = requiredEnum(body, "kind", ACTIVITY_KINDS);
    const date = optionalDate(body, "date");
    const steps = optionalNumber(body, "steps", { min: 0, max: 2_000_000, integer: true });
    const durationMinutes = optionalNumber(body, "durationMinutes", { min: 0, max: 1440, integer: true });
    const distanceKm = optionalNumber(body, "distanceKm", { min: 0, max: 1000 });
    const averageHeartRateBpm = optionalNumber(body, "averageHeartRateBpm", { min: 20, max: 260, integer: true });
    const estimatedCaloriesBurned = optionalNumber(body, "estimatedCaloriesBurned", { min: 0, max: 50_000 });
    const effort = optionalEnum(body, "effort", EFFORT_LEVELS);
    const recordedVia = optionalString(body, "recordedVia", { maxLength: 200 });
    const externalId = optionalString(body, "externalId", { maxLength: 500 });
    const notes = optionalString(body, "notes", { maxLength: 4000 });

    const record = await services.activity.record(userId, {
      kind,
      ...(date !== undefined ? { date } : {}),
      ...(steps !== undefined ? { steps } : {}),
      ...(durationMinutes !== undefined ? { durationMinutes } : {}),
      ...(distanceKm !== undefined ? { distanceKm } : {}),
      ...(averageHeartRateBpm !== undefined ? { averageHeartRateBpm } : {}),
      ...(estimatedCaloriesBurned !== undefined ? { estimatedCaloriesBurned } : {}),
      ...(effort ? { effort } : {}),
      ...(recordedVia !== undefined ? { recordedVia } : {}),
      ...(externalId !== undefined ? { externalId } : {}),
      ...(notes !== undefined ? { notes } : {}),
    });
    return { status: 201, body: { activity: record } };
  });

  router.add("GET", "/v0/users/:userId/activity", async ({ params, query }) => {
    const kind = queryEnum(query, "kind", ACTIVITY_KINDS);
    const limit = queryNumber(query, "limit", 1, 500);
    const from = queryCalendarDate(query, "from");
    const to = queryCalendarDate(query, "to");
    const history = await services.activity.history(params["userId"]!, {
      ...(kind ? { kind } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
    });
    return { body: { activity: history } };
  });

  // -------------------------------------------------------------------------
  // Nutrition
  // -------------------------------------------------------------------------
  router.add("POST", "/v0/users/:userId/foods", async ({ params, body }) => {
    const userId = params["userId"]!;
    const sourceId = optionalUuid(body, "sourceId");
    const name = requiredString(body, "name", { maxLength: 300 });
    const brand = optionalString(body, "brand", { maxLength: 300 });
    const densityBasis = requiredEnum(body, "densityBasis", ["per_100g", "per_100ml"] as const);
    const nutrientsPer100g = parseNutrients(body);
    const barcode = optionalString(body, "barcode", { maxLength: 100 });
    const externalId = optionalString(body, "externalId", { maxLength: 500 });
    const servingsRaw = optionalObjectArray(body, "servings", { maxItems: 30 });
    const servings = servingsRaw?.map((serving, index) => {
      const label = requiredString(serving, `servings[${index}].label`, { maxLength: 100 });
      const grams = optionalNumber(serving, `servings[${index}].grams`, { min: 0.01, max: 100_000 });
      const milliliters = optionalNumber(serving, `servings[${index}].milliliters`, { min: 0.01, max: 100_000 });
      const unitQuantity = optionalNumber(serving, `servings[${index}].unitQuantity`, { min: 0.01, max: 10_000 });
      const unitName = optionalString(serving, `servings[${index}].unitName`, { maxLength: 100 });
      const bases = [grams !== undefined, milliliters !== undefined].filter(Boolean).length;
      if ((bases === 1 && unitQuantity !== undefined) || (bases === 0 && (unitQuantity === undefined || !unitName))) {
        throw new RouteError(
          400,
          "validation_failed",
          `servings[${index}] must define either grams or milliliters, or unitQuantity + unitName`,
        );
      }
      return {
        label,
        ...(grams !== undefined ? { grams } : {}),
        ...(milliliters !== undefined ? { milliliters } : {}),
        ...(unitQuantity !== undefined ? { unitQuantity } : {}),
        ...(unitName !== undefined ? { unitName } : {}),
      };
    });
    const defaultServingLabel = optionalString(body, "defaultServingLabel", { maxLength: 100 });

    const food = await services.nutrition.createFood(userId, {
      ...(sourceId !== undefined ? { sourceId } : {}),
      name,
      ...(brand !== undefined ? { brand } : {}),
      densityBasis,
      nutrientsPer100g,
      ...(servings ? { servings } : {}),
      ...(defaultServingLabel !== undefined ? { defaultServingLabel } : {}),
      ...(barcode !== undefined ? { barcode } : {}),
      ...(externalId !== undefined ? { externalId } : {}),
    });
    return { status: 201, body: { food } };
  });

  router.add("GET", "/v0/foods/:foodId", async ({ params }) => ({
    body: { food: await services.nutrition.getFood(params["foodId"]!) },
  }));

  function parseMealItems(body: Record<string, unknown>): Array<{
    id?: string;
    foodId: string;
    quantityGrams: number;
    confidence?: (typeof CONFIDENCE_VALUES)[number];
    notes?: string;
  }> {
    const items = optionalObjectArray(body, "items", { maxItems: 100 });
    if (!items || items.length === 0) {
      throw new RouteError(400, "validation_failed", "items must be a non-empty array");
    }
    return items.map((item, index) => {
      const foodId = requiredUuid(item, `items[${index}].foodId`);
      const quantityGrams = requiredNumber(item, `items[${index}].quantityGrams`, {
        min: 0.01,
        max: 100_000,
      });
      const confidence = optionalEnum(item, `items[${index}].confidence`, CONFIDENCE_VALUES);
      const notes = optionalString(item, `items[${index}].notes`, { maxLength: 2000 });
      const id = optionalUuid(item, `items[${index}].id`);
      return {
        ...(id !== undefined ? { id } : {}),
        foodId,
        quantityGrams,
        ...(confidence ? { confidence } : {}),
        ...(notes !== undefined ? { notes } : {}),
      };
    });
  }

  router.add("POST", "/v0/users/:userId/meals", async ({ params, body }) => {
    const userId = params["userId"]!;
    const localDate = optionalDate(body, "localDate");
    const consumedAt = optionalTimestamp(body, "consumedAt");
    const slot = optionalEnum(body, "slot", MEAL_SLOTS);
    const notes = optionalString(body, "notes", { maxLength: 4000 });
    const clientRequestId = optionalString(body, "clientRequestId", { maxLength: 200 });
    const items = parseMealItems(body);

    const meal = await services.nutrition.createMeal(userId, {
      ...(localDate !== undefined ? { localDate } : {}),
      ...(consumedAt !== undefined ? { consumedAt } : {}),
      ...(slot ? { slot } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(clientRequestId !== undefined ? { clientRequestId } : {}),
      items,
    });
    return { status: 201, body: { meal } };
  });

  router.add("POST", "/v0/users/:userId/meals/:mealId/items", async ({ params, body }) => {
    const single = parseMealItems({ items: [asObject(body, "body")] })[0]!;
    const meal = await services.nutrition.addMealItem(params["mealId"]!, single);
    return { status: 201, body: { meal } };
  });

  router.add("GET", "/v0/users/:userId/meals", async ({ params, query }) => {
    const date = query.get("date");
    if (date !== null && date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new RouteError(400, "validation_failed", "query parameter date must be YYYY-MM-DD");
    }
    const meals = await services.nutrition.listMeals(params["userId"]!, date ?? undefined);
    return { body: { meals } };
  });

  router.add("GET", "/v0/users/:userId/nutrition/daily", async ({ params, query }) => {
    const date = query.get("date");
    if (date !== null && date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new RouteError(400, "validation_failed", "query parameter date must be YYYY-MM-DD");
    }
    const daily = await services.nutrition.getDaily(params["userId"]!, date ?? undefined);
    if (!daily) throw new RouteError(404, "not_found", "no daily nutrition record for that date");
    return { body: { daily } };
  });

  // -------------------------------------------------------------------------
  // Coaching loop
  // -------------------------------------------------------------------------
  router.add("POST", "/v0/users/:userId/diagnoses", async ({ params, body }) => {
    const userId = params["userId"]!;
    const code = requiredString(body, "code", { maxLength: 200 });
    const title = requiredString(body, "title", { maxLength: 300 });
    const summary = requiredString(body, "summary", { maxLength: 4000 });
    const severity = requiredEnum(body, "severity", SEVERITIES);
    const status = optionalEnum(body, "status", DIAGNOSIS_STATUSES);
    const analysisWindowDays = optionalNumber(body, "analysisWindowDays", { min: 1, max: 3650, integer: true });
    const activeGoalId = optionalUuid(body, "activeGoalId");
    const activePlanVersionId = optionalUuid(body, "activePlanVersionId");
    const contextSnapshot = optionalPlainObject(body, "contextSnapshot");
    const contributingFactors = optionalStringArray(body, "contributingFactors", { maxItems: 50, maxLength: 500 });
    const ruledOut = optionalStringArray(body, "ruledOut", { maxItems: 50, maxLength: 500 });
    const evidence = parseEvidence(body);

    const diagnosis = await services.coaching.createDiagnosis(userId, {
      code,
      title,
      summary,
      severity,
      ...(status ? { status } : {}),
      ...(analysisWindowDays !== undefined ? { analysisWindowDays } : {}),
      ...(activeGoalId !== undefined ? { activeGoalId } : {}),
      ...(activePlanVersionId !== undefined ? { activePlanVersionId } : {}),
      ...(contextSnapshot ? { contextSnapshot } : {}),
      ...(contributingFactors ? { contributingFactors } : {}),
      ...(ruledOut ? { ruledOut } : {}),
      ...(evidence ? { evidence } : {}),
    });
    return { status: 201, body: { diagnosis } };
  });

  router.add(
    "POST",
    "/v0/users/:userId/diagnoses/:diagnosisId/evidence",
    async ({ params, body }) => {
      const evidence = parseEvidence(body);
      if (!evidence || evidence.length === 0) {
        throw new RouteError(400, "validation_failed", "evidence must be a non-empty array");
      }
      const diagnosis = await services.coaching.attachEvidence(params["diagnosisId"]!, evidence);
      return { status: 201, body: { diagnosis } };
    },
  );

  router.add("GET", "/v0/users/:userId/diagnoses", async ({ params, query }) => {
    const status = queryEnum(query, "status", DIAGNOSIS_STATUSES);
    const limit = queryNumber(query, "limit", 1, 500);
    const diagnoses = await services.coaching.listDiagnoses(params["userId"]!, {
      ...(status ? { status } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    return { body: { diagnoses } };
  });

  router.add("POST", "/v0/users/:userId/recommendations", async ({ params, body }) => {
    const userId = params["userId"]!;
    const diagnosisId = optionalUuid(body, "diagnosisId");
    const interventionId = optionalUuid(body, "interventionId");
    const headline = requiredString(body, "headline", { maxLength: 300 });
    const explanation = requiredString(body, "explanation", { maxLength: 8000 });
    const alternativesConsidered = optionalStringArray(body, "alternativesConsidered", {
      maxItems: 20,
      maxLength: 1000,
    });
    const presentedAt = optionalTimestamp(body, "presentedAt");
    const status = optionalEnum(body, "status", RECOMMENDATION_STATUSES);
    const evidence = parseEvidence(body);

    const recommendation = await services.coaching.createRecommendation(userId, {
      ...(diagnosisId !== undefined ? { diagnosisId } : {}),
      ...(interventionId !== undefined ? { interventionId } : {}),
      headline,
      explanation,
      ...(alternativesConsidered ? { alternativesConsidered } : {}),
      ...(presentedAt !== undefined ? { presentedAt } : {}),
      ...(status ? { status } : {}),
      ...(evidence ? { evidence } : {}),
    });
    return { status: 201, body: { recommendation } };
  });

  router.add("GET", "/v0/users/:userId/recommendations", async ({ params, query }) => {
    const limit = queryNumber(query, "limit", 1, 500);
    const recommendations = await services.coaching.listRecommendations(params["userId"]!, {
      ...(limit !== undefined ? { limit } : {}),
    });
    return { body: { recommendations } };
  });

  router.add("POST", "/v0/users/:userId/interventions", async ({ params, body }) => {
    const userId = params["userId"]!;
    const kind = requiredEnum(body, "kind", INTERVENTION_KINDS);
    const diagnosisId = optionalUuid(body, "diagnosisId");
    const activeGoalId = optionalUuid(body, "activeGoalId");
    const activePlanVersionId = optionalUuid(body, "activePlanVersionId");
    const parameters = optionalPlainObject(body, "parameters");
    const rationale = requiredString(body, "rationale", { maxLength: 4000 });
    const expectedEffect = requiredString(body, "expectedEffect", { maxLength: 4000 });
    const reviewOn = optionalDate(body, "reviewOn");
    const status = optionalEnum(body, "status", INTERVENTION_STATUSES);

    const intervention = await services.coaching.createIntervention(userId, {
      kind,
      ...(diagnosisId !== undefined ? { diagnosisId } : {}),
      ...(activeGoalId !== undefined ? { activeGoalId } : {}),
      ...(activePlanVersionId !== undefined ? { activePlanVersionId } : {}),
      ...(parameters ? { parameters: parameters as never } : {}),
      rationale,
      expectedEffect,
      ...(reviewOn !== undefined ? { reviewOn } : {}),
      ...(status ? { status } : {}),
    });
    return { status: 201, body: { intervention } };
  });

  router.add("GET", "/v0/users/:userId/interventions", async ({ params, query }) => {
    const status = queryEnum(query, "status", INTERVENTION_STATUSES);
    const limit = queryNumber(query, "limit", 1, 500);
    const interventions = await services.coaching.listInterventions(params["userId"]!, {
      ...(status ? { status } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    return { body: { interventions } };
  });

  router.add(
    "POST",
    "/v0/users/:userId/interventions/:interventionId/outcomes",
    async ({ params, body }) => {
      const evaluationWindow = requiredString(body, "evaluationWindow", { maxLength: 100 });
      const verdict = requiredEnum(body, "verdict", OUTCOME_VERDICTS);
      const explanation = requiredString(body, "explanation", { maxLength: 8000 });
      const evaluatedAt = optionalTimestamp(body, "evaluatedAt");
      const observations = optionalStringArray(body, "observations", { maxItems: 50, maxLength: 1000 });
      const followUpDiagnosisId = optionalUuid(body, "followUpDiagnosisId");

      const outcome = await services.coaching.recordOutcome(
        params["userId"]!,
        params["interventionId"]!,
        {
          evaluationWindow,
          verdict,
          explanation,
          ...(evaluatedAt !== undefined ? { evaluatedAt } : {}),
          ...(observations ? { observations } : {}),
          ...(followUpDiagnosisId !== undefined ? { followUpDiagnosisId } : {}),
        },
      );
      return { status: 201, body: { outcome } };
    },
  );

  router.add(
    "GET",
    "/v0/users/:userId/interventions/:interventionId/outcomes",
    async ({ params }) => ({
      body: { outcomes: await services.coaching.listOutcomes(params["interventionId"]!) },
    }),
  );

  // -------------------------------------------------------------------------
  // Exercise knowledge (Phase 2)
  //
  // Thin handlers: validate, delegate to the knowledge service, shape the
  // response. No scoring, ranking, overlap maths or anatomy logic lives here —
  // that is deterministic code in packages/fitness-core, where it can be
  // tested without a database and cited as evidence.
  // -------------------------------------------------------------------------

  function optionalCalendarDate(query: URLSearchParams): string | undefined {
    const at = query.get("at");
    if (at === null || at === "") return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(at)) {
      throw new RouteError(400, "validation_failed", "query parameter at must be YYYY-MM-DD");
    }
    return at;
  }

  router.add("GET", "/v0/muscles", async ({ query }) => ({
    body: {
      muscles: await services.knowledge.muscleCatalog({
        includeInactive: query.get("includeInactive") === "true",
      }),
    },
  }));

  router.add("GET", "/v0/muscles/:muscleId", async ({ params }) => ({
    body: { muscle: await services.knowledge.muscleById(params["muscleId"]!) },
  }));

  router.add("GET", "/v0/movement-functions", async () => ({
    body: { movementFunctions: await services.knowledge.movementFunctions() },
  }));

  router.add("GET", "/v0/exercises", async ({ query }) => {
    const body = queryToBody(query);
    const q = optionalString(body, "q", { maxLength: 200 });
    const muscleSlug = optionalString(body, "muscleSlug", { maxLength: 120 });
    const structureSlug = optionalString(body, "structureSlug", { maxLength: 120 });
    const category = optionalEnum(body, "category", EXERCISE_CATEGORIES);
    const movementPattern = optionalEnum(body, "movementPattern", MOVEMENT_PATTERNS);
    const equipmentIds = optionalStringArray(body, "equipmentIds", { maxItems: 20 });

    const exercises = await services.knowledge.searchExercises({
      ...(q !== undefined ? { q } : {}),
      ...(muscleSlug !== undefined ? { muscleSlug } : {}),
      ...(structureSlug !== undefined ? { structureSlug } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(movementPattern !== undefined ? { movementPattern } : {}),
      ...(equipmentIds !== undefined ? { equipmentIds } : {}),
      includeInactive: query.get("includeInactive") === "true",
    });
    return { body: { exercises } };
  });

  router.add("GET", "/v0/exercises/:exerciseId", async ({ params, query }) => {
    const detail = await services.knowledge.exerciseDetail(params["exerciseId"]!, {
      includeRetiredMedia: query.get("includeRetiredMedia") === "true",
    });
    return { body: detail };
  });

  router.add("GET", "/v0/exercises/:exerciseId/target-map", async ({ params }) => ({
    body: { targetMap: (await services.knowledge.exerciseDetail(params["exerciseId"]!)).targetMap },
  }));

  router.add("GET", "/v0/exercises/:exerciseId/form-guidance", async ({ params }) => ({
    body: { formGuidance: (await services.knowledge.exerciseDetail(params["exerciseId"]!)).formGuidance },
  }));

  router.add("GET", "/v0/exercises/:exerciseId/media", async ({ params, query }) => ({
    body: {
      media: await services.knowledge.mediaMetadata(
        params["exerciseId"]!,
        query.get("includeRetired") === "true",
      ),
    },
  }));

  router.add("GET", "/v0/users/:userId/exercise-universe", async ({ params, query }) => {
    const body = queryToBody(query);
    const at = optionalCalendarDate(query);
    const targetMuscleSlugs = optionalStringArray(body, "targetMuscleSlugs", { maxItems: 40 });
    const movementPattern = optionalEnum(body, "movementPattern", MOVEMENT_PATTERNS);
    const movementFunction = optionalString(body, "movementFunction", { maxLength: 80 }) as
      | MovementFunction
      | undefined;
    return {
      body: {
        universe: await services.knowledge.exerciseUniverse(params["userId"]!, {
          ...(at !== undefined ? { at } : {}),
          ...(targetMuscleSlugs !== undefined ? { targetMuscleSlugs } : {}),
          ...(movementPattern !== undefined ? { movementPattern } : {}),
          ...(movementFunction !== undefined ? { movementFunction } : {}),
          includeUnavailable: query.get("includeUnavailable") === "true",
          includeRetired: query.get("includeRetired") === "true",
        }),
      },
    };
  });

  router.add("GET", "/v0/users/:userId/exercises/:exerciseId/decision", async ({ params, query }) => {
    const body = queryToBody(query);
    const at = optionalCalendarDate(query);
    const targetMuscleSlugs = optionalStringArray(body, "targetMuscleSlugs", { maxItems: 40 });
    const alongsideExerciseIds = optionalStringArray(body, "alongsideExerciseIds", { maxItems: 30 });
    const goalKind = optionalEnum(body, "goalKind", GOAL_KINDS);
    const trigger = optionalEnum(body, "trigger", SUBSTITUTION_TRIGGERS);
    const limit = queryNumber(query, "limit", 1, 20);
    return {
      body: await services.knowledge.exerciseDecision(
        params["userId"]!,
        params["exerciseId"]!,
        {
          ...(at !== undefined ? { at } : {}),
          ...(targetMuscleSlugs !== undefined ? { targetMuscleSlugs } : {}),
          ...(alongsideExerciseIds !== undefined ? { alongsideExerciseIds } : {}),
          ...(goalKind !== undefined ? { goalKind } : {}),
          ...(trigger !== undefined ? { trigger } : {}),
          ...(limit !== undefined ? { alternativeLimit: limit } : {}),
          explain: query.get("explain") !== "false",
        },
      ),
    };
  });

  router.add("POST", "/v0/users/:userId/exercise-preferences", async ({ params, body }) => {
    const exerciseId = requiredUuid(body, "exerciseId");
    const preference = requiredEnum(body, "preference", EXERCISE_PREFERENCE_KINDS);
    const reason = optionalString(body, "reason", { maxLength: 1000 });
    // The interval boundary is the user's local today, not the server's.
    const localToday = await services.users.localToday(params["userId"]!);
    const record = await services.knowledge.setExercisePreference(params["userId"]!, {
      exerciseId,
      preference,
      ...(reason !== undefined ? { reason } : {}),
      validFrom: localToday,
    });
    return { status: 201, body: { preference: record } };
  });

  router.add("GET", "/v0/users/:userId/exercise-preferences", async ({ params, query }) => {
    const at = optionalCalendarDate(query);
    return {
      body: {
        preferences: await services.knowledge.exercisePreferences(params["userId"]!, at),
      },
    };
  });

  router.add("POST", "/v0/users/:userId/muscle-coverage", async ({ params, body }) => {
    const exerciseIds = optionalStringArray(body, "exerciseIds", { maxItems: 60 }) ?? [];
    if (exerciseIds.length === 0) {
      throw new RouteError(400, "validation_failed", "exerciseIds must be a non-empty array");
    }
    for (const id of exerciseIds) {
      if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
        throw new RouteError(400, "validation_failed", "exerciseIds must be UUIDs");
      }
    }
    const focusMuscleSlugs = optionalStringArray(body, "focusMuscleSlugs", { maxItems: 40 });
    const focusStructureIds = optionalStringArray(body, "focusStructureIds", { maxItems: 40 });
    return {
      body: {
        coverage: await services.knowledge.muscleCoverage(params["userId"]!, exerciseIds, {
          ...(focusMuscleSlugs !== undefined ? { focusMuscleSlugs } : {}),
          ...(focusStructureIds !== undefined ? { focusStructureIds } : {}),
        }),
      },
    };
  });
}
