import { MOVEMENT_PATTERNS } from "@fitcoach/domain";
import type {
  MovementFunction,
  PerformanceObservationSummary,
  ProgressionActualChange,
  Profile,
  DecisionSnapshotStatus,
} from "@fitcoach/domain";
import type { IntentClassification } from "@fitcoach/ai";
import type { PlanVersionInput } from "@fitcoach/db";
import { buildExampleUser, createUserSummary } from "./example";
import type { AppServices } from "./services";
import type { Router } from "./http";
import { RouteError } from "./http";
import type { RouteHandler, RouteContext } from "./http";
import { CoachingError, type CoachingRequest } from "./services/aiCoaching/orchestrator";
import { authMiddleware } from "./services/authMiddleware";
import {
  asObject,
  optionalBoolean,
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
  requiredStringArray,
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

const OBSERVATION_ORIGINS = [
  "wearable",
  "manual",
  "phone",
  "partner_api",
  "other",
] as const;
const CONFIDENCE_VALUES_ACTIVITY = ["high", "medium", "low"] as const;
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
// Phase 3.1 — training environment + performance/progression contracts
const TRAINING_ENVIRONMENT_KINDS = [
  "gym",
  "home",
  "home_no_equipment",
  "home_limited_equipment",
  "hotel",
  "travel",
  "outdoor",
  "custom",
] as const;
const SESSION_CLASSIFICATIONS = ["planned", "adapted", "makeup", "unplanned"] as const;
const PERFORMANCE_LOAD_KINDS = [
  "external_load",
  "bodyweight",
  "weighted_bodyweight",
  "assisted_bodyweight",
  "band",
  "none",
] as const;
const PERFORMANCE_SOURCES = ["manual", "imported", "inferred"] as const;
const PROGRESSION_DECISION_KINDS = ["recommended", "accepted", "rejected", "deferred"] as const;
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

// --- Barcode Scanner -----------------------------------------------------------

const BARCODE_PATTERN = /^[0-9]{8,14}$/; // EAN-8, EAN-13, UPC-A, UPC-E

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

function queryToObject(query: URLSearchParams): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  query.forEach((value, key) => {
    obj[key] = value;
  });
  return obj;
}

/**
 * Wrap a coaching route handler so CoachingError (4xx ownership/validation
 * failures) becomes a RouteError and reaches the client as a proper
 * HTTP error envelope rather than a 500.
 */
function coachingHandler(handler: RouteHandler): RouteHandler {
  return async (context: RouteContext) => {
    try {
      return await handler(context);
    } catch (error) {
      if (error instanceof CoachingError) {
        throw new RouteError(error.status, error.code, error.message);
      }
      throw error;
    }
  };
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
  // Auth (Supabase Auth)
  // -------------------------------------------------------------------------
  router.add("POST", "/v0/auth/signup", async ({ body }) => {
    const email = requiredString(body, "email", { maxLength: 320 });
    const password = requiredString(body, "password", { minLength: 8, maxLength: 128 });
    const result = await services.auth.signUp({ email, password });
    if (result.error) throw new RouteError(400, "signup_failed", result.error);
    return { status: 201, body: { user: result.user, session: result.session } };
  });

  router.add("POST", "/v0/auth/signin", async ({ body }) => {
    const email = requiredString(body, "email", { maxLength: 320 });
    const password = requiredString(body, "password", { minLength: 8, maxLength: 128 });
    const result = await services.auth.signIn({ email, password });
    if (result.error) throw new RouteError(401, "signin_failed", result.error);
    return { body: { user: result.user, session: result.session } };
  });

  router.add("POST", "/v0/auth/signout", authMiddleware(async ({ accessToken }) => {
    const result = await services.auth.signOut(accessToken);
    if (result.error) throw new RouteError(400, "signout_failed", result.error);
    return { body: { success: true } };
  }));

  router.add("POST", "/v0/auth/refresh", async ({ body }) => {
    const refreshToken = requiredString(body, "refreshToken");
    const result = await services.auth.refreshSession(refreshToken);
    if (result.error) throw new RouteError(401, "refresh_failed", result.error);
    return { body: { user: result.user, session: result.session } };
  });

  // -------------------------------------------------------------------------
  // Health & Observability
  // -------------------------------------------------------------------------
  router.add("GET", "/healthz", () => ({ body: { status: "ok" } }));

  router.add("GET", "/ready", async () => {
    const result = await services.health.runChecks();
    const status = result.status === "healthy" ? 200 : result.status === "degraded" ? 200 : 503;
    return { status, body: result };
  });

  router.add("GET", "/live", () => {
    const result = services.health.liveness();
    return { body: result };
  });

  router.add("GET", "/v0/auth/me", authMiddleware(async ({ userId, userEmail }) => {
    const user = await services.users.get(userId);
    return { body: { user: { ...user, email: userEmail } } };
  }));

  // -------------------------------------------------------------------------
  // Users (legacy - will require auth in future)
  // -------------------------------------------------------------------------
  router.add("POST", "/v0/users", async ({ body }) => {
    const email = optionalString(body, "email", { maxLength: 320 });
    const displayName = optionalString(body, "displayName", { maxLength: 200 });
    const timezone = optionalString(body, "timezone", { maxLength: 100 });
    const result = await services.users.create({
      ...(email !== undefined ? { email } : {}),
      ...(displayName !== undefined ? { displayName } : {}),
      ...(timezone !== undefined ? { timezone } : {}),
    });
    return {
      status: result.created ? 201 : 200,
      body: { user: result.user },
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
  // Equipment catalog (read-only Phase 2 knowledge, used by onboarding).
  router.add("GET", "/v0/equipment", async () => ({
    body: { equipment: await services.equipment.catalog() },
  }));

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
  function parsePlanVersion(body: Record<string, unknown>): PlanVersionInput {
    const status = optionalEnum(body, "status", ["active", "superseded", "draft"]);
    const configVersion = optionalString(body, "configVersion", { maxLength: 100 });
    const supersedesId = optionalUuid(body, "supersedesId");
    const effectiveFrom = requiredDate(body, "effectiveFrom");
    const effectiveUntil = optionalDate(body, "effectiveUntil");
    const sessionsRaw = optionalObjectArray(body, "sessions", { maxItems: 21 });

    // Build planJson from sessions
    const planJsonObj = {
      sessions: (sessionsRaw ?? []).map((session, index) => {
        const name = requiredString(session, `sessions[${index}].name`, { maxLength: 200 });
        const dayOfWeek = optionalNumber(session, `sessions[${index}].dayOfWeek`, {
          min: 0,
          max: 6,
          integer: true,
        });
        const notes = optionalString(session, `sessions[${index}].notes`, { maxLength: 2000 });
        const estimatedDurationMinutes = optionalNumber(session, `sessions[${index}].estimatedDurationMinutes`, {
          min: 0,
          max: 7200,
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
          const targetReps = optionalString(slot, `sessions[${index}].slots[${slotIndex}].targetReps`, { maxLength: 20 });
          const targetRir = optionalNumber(slot, `sessions[${index}].slots[${slotIndex}].targetRir`, {
            min: 0,
            max: 10,
          });
          const loadPrescription = optionalString(slot, `sessions[${index}].slots[${slotIndex}].loadPrescription`, { maxLength: 20 });
          const loadValue = optionalNumber(slot, `sessions[${index}].slots[${slotIndex}].loadValue`, {
            min: 0,
            max: 1000,
          });
          const notes = optionalString(slot, `sessions[${index}].slots[${slotIndex}].notes`, {
            maxLength: 2000,
          });
          return {
            exerciseId,
            ...(targetSets !== undefined ? { targetSets } : {}),
            ...(targetReps !== undefined ? { targetReps } : {}),
            ...(targetRir !== undefined ? { targetRir } : {}),
            ...(loadPrescription !== undefined ? { loadPrescription } : {}),
            ...(loadValue !== undefined ? { loadValue } : {}),
            ...(notes !== undefined ? { notes } : {}),
          };
        });
        return {
          name,
          dayOfWeek: dayOfWeek ?? 0,
          ...(notes !== undefined ? { notes } : {}),
          ...(estimatedDurationMinutes !== undefined ? { estimatedDurationMinutes } : {}),
          slots,
        };
      }),
    };

    return {
      status: status ?? "active",
      planJson: JSON.stringify(planJsonObj),
      configVersion,
      supersedesId,
      effectiveFrom,
      effectiveUntil,
      sessions: planJsonObj.sessions,
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

  // Ownership-checked (§41): a plan id alone must not expose another user's plan.
  router.add("GET", "/v0/users/:userId/training-plans/:planId", async ({ params }) => ({
    body: { plan: await services.planner.getPlanForUser(params["userId"]!, params["planId"]!) },
  }));

  // -------------------------------------------------------------------------
  // Adaptive training planner (Phase 3)
  // -------------------------------------------------------------------------

  /** Shared body parsing for generation: explicit days/duration/priorities. */
  function parseGenerationCommand(body: Record<string, unknown>) {
    const asOf = requiredDate(body, "asOf");
    const planId = optionalUuid(body, "planId");
    const name = optionalString(body, "name", { maxLength: 200 });
    const goalId = optionalUuid(body, "goalId");
    const goalKind = optionalEnum(body, "goalKind", GOAL_KINDS);
    const priorities = optionalStringArray(body, "priorities", { maxItems: 20 });
    // 0 is accepted on purpose: "no days available" is a modellable input that
    // the planner answers with an explicit infeasibility, not a transport error.
    const availableTrainingDays = optionalNumber(body, "availableTrainingDays", {
      min: 0,
      max: 7,
      integer: true,
    });
    const maxSessionDurationMinutes = optionalNumber(body, "maxSessionDurationMinutes", {
      min: 10,
      max: 300,
      integer: true,
    });
    const experience = optionalEnum(body, "experience", EXPERIENCE_VALUES);
    const equipmentIds = optionalStringArray(body, "equipmentIds", { maxItems: 200 });
    if (equipmentIds) {
      for (const id of equipmentIds) {
        if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
          throw new RouteError(400, "validation_failed", "equipmentIds must be UUIDs");
        }
      }
    }
    return {
      asOf,
      ...(planId !== undefined ? { planId } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(goalId !== undefined ? { goalId } : {}),
      ...(goalKind !== undefined ? { goalKind } : {}),
      ...(priorities !== undefined ? { priorities } : {}),
      ...(availableTrainingDays !== undefined ? { availableTrainingDays } : {}),
      ...(maxSessionDurationMinutes !== undefined ? { maxSessionDurationMinutes } : {}),
      ...(experience !== undefined ? { experience } : {}),
      ...(equipmentIds !== undefined ? { equipmentIds } : {}),
    };
  }

  router.add("POST", "/v0/users/:userId/training-plans/generate", async ({ params, body }) => {
    const result = await services.planner.generatePlan(
      params["userId"]!,
      parseGenerationCommand(body),
    );
    // Infeasible requests are a modelled outcome, not a transport failure: the
    // reasons travel with the 200 so the caller can explain the gap.
    return { status: result.plan ? 201 : 200, body: result };
  });

  router.add(
    "GET",
    "/v0/users/:userId/training-plans/:planId/versions/:versionNumber",
    async ({ params }) => {
      const versionNumber = Number(params["versionNumber"]);
      if (!Number.isInteger(versionNumber) || versionNumber < 1) {
        throw new RouteError(400, "validation_failed", "versionNumber must be a positive integer");
      }
      const { version } = await services.planner.getVersion(
        params["userId"]!,
        params["planId"]!,
        versionNumber,
      );
      return { body: { version } };
    },
  );

  router.add(
    "POST",
    "/v0/users/:userId/training-plans/:planId/adapt",
    async ({ params, body }) => {
      const asOf = optionalDate(body, "asOf");
      const result = await services.planner.adaptPlan(params["userId"]!, params["planId"]!, {
        ...(asOf !== undefined ? { asOf } : {}),
      });
      return { body: result };
    },
  );

  router.add("GET", "/v0/users/:userId/training-plans/:planId/compare", async ({ params, query }) => {
    const from = queryNumber(query, "from", 1, 1_000_000);
    const to = queryNumber(query, "to", 1, 1_000_000);
    if (from === undefined || to === undefined || !Number.isInteger(from) || !Number.isInteger(to)) {
      throw new RouteError(400, "validation_failed", "query parameters from and to must be version numbers");
    }
    return {
      body: await services.planner.compareVersions(params["userId"]!, params["planId"]!, from, to),
    };
  });

  function queryVersionNumber(query: URLSearchParams): number | undefined {
    const value = queryNumber(query, "version", 1, 1_000_000);
    if (value === undefined) return undefined;
    if (!Number.isInteger(value)) {
      throw new RouteError(400, "validation_failed", "query parameter version must be an integer");
    }
    return value;
  }

  router.add("GET", "/v0/users/:userId/training-plans/:planId/decisions", async ({ params, query }) => ({
    body: {
      decisions: await services.planner.listDecisions(
        params["userId"]!,
        params["planId"]!,
        queryVersionNumber(query),
      ),
    },
  }));

  router.add("GET", "/v0/users/:userId/training-plans/:planId/constraints", async ({ params, query }) => ({
    body: {
      constraints: await services.planner.listConstraints(
        params["userId"]!,
        params["planId"]!,
        queryVersionNumber(query),
      ),
    },
  }));

  router.add("GET", "/v0/users/:userId/training-plans/:planId/coverage", async ({ params, query }) => ({
    body: await services.planner.getCoverage(
      params["userId"]!,
      params["planId"]!,
      queryVersionNumber(query),
    ),
  }));

  router.add("GET", "/v0/users/:userId/training-plans/:planId/progression", async ({ params, query }) => ({
    body: await services.planner.getProgression(
      params["userId"]!,
      params["planId"]!,
      queryVersionNumber(query),
    ),
  }));

  router.add("GET", "/v0/users/:userId/training-state", async ({ params }) => ({
    body: { trainingState: await services.planner.getTrainingState(params["userId"]!) },
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
    const environmentKind = optionalEnum(body, "environmentKind", TRAINING_ENVIRONMENT_KINDS);
    const sessionClassification = optionalEnum(body, "sessionClassification", SESSION_CLASSIFICATIONS);
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
      ...(environmentKind !== undefined ? { environmentKind } : {}),
      ...(sessionClassification !== undefined ? { sessionClassification } : {}),
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
      // Phase 3.1: link the performed group to its planned slot and record any
      // substitution explicitly (§26 — never silently swap an exercise).
      const slotId = optionalUuid(body, "slotId");
      const substitutedFromExerciseId = optionalUuid(body, "substitutedFromExerciseId");
      const performanceSource = optionalEnum(body, "performanceSource", PERFORMANCE_SOURCES);
      const substitutionReason = optionalString(body, "substitutionReason", {
        maxLength: 500,
      });
      const hasOptions =
        slotId !== undefined ||
        substitutedFromExerciseId !== undefined ||
        performanceSource !== undefined ||
        substitutionReason !== undefined;
      const group = await services.training.recordExercise(params["workoutId"]!, {
        exerciseId,
        ...(position !== undefined ? { position } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(hasOptions
          ? {
              options: {
                ...(slotId !== undefined ? { slotId } : {}),
                ...(substitutedFromExerciseId !== undefined
                  ? { substitutedFromExerciseId }
                  : {}),
                ...(performanceSource !== undefined ? { performanceSource } : {}),
                ...(substitutionReason !== undefined ? { substitutionReason } : {}),
              },
            }
          : {}),
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
    // Phase 3.1: bodyweight work is load, not missing data (§4), and a retried
    // submission must not record the set twice (§32).
    const loadKind = optionalEnum(body, "loadKind", PERFORMANCE_LOAD_KINDS);
    const assistanceLoadKg = optionalNumber(body, "assistanceLoadKg", { min: 0, max: 1000 });
    const clientRequestId = optionalString(body, "clientRequestId", { maxLength: 200 });

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
      ...(loadKind !== undefined ? { loadKind } : {}),
      ...(assistanceLoadKg !== undefined ? { assistanceLoadKg } : {}),
      ...(clientRequestId !== undefined ? { clientRequestId } : {}),
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
  // Training environments + continuity (Phase 3.1 §12–§25)
  // -------------------------------------------------------------------------

  router.add("POST", "/v0/users/:userId/training-environments", async ({ params, body }) => {
    const kind = requiredEnum(body, "kind", TRAINING_ENVIRONMENT_KINDS);
    const effectiveFrom = requiredDate(body, "effectiveFrom");
    const effectiveTo = optionalDate(body, "effectiveTo");
    const reason = optionalString(body, "reason", { maxLength: 500 });
    const isTemporary = optionalBoolean(body, "isTemporary");
    const notes = optionalString(body, "notes", { maxLength: 2000 });
    const availableEquipmentIds = optionalStringArray(body, "availableEquipmentIds", {
      maxItems: 200,
    });
    const unavailableEquipmentIds = optionalStringArray(body, "unavailableEquipmentIds", {
      maxItems: 200,
    });
    const result = await services.continuity.setEnvironment(params["userId"]!, {
      kind,
      effectiveFrom,
      ...(effectiveTo !== undefined ? { effectiveTo } : {}),
      ...(reason !== undefined ? { reason } : {}),
      ...(isTemporary !== undefined ? { isTemporary } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(availableEquipmentIds !== undefined ? { availableEquipmentIds } : {}),
      ...(unavailableEquipmentIds !== undefined ? { unavailableEquipmentIds } : {}),
    });
    // A replayed submission is the same record, not a new one (§32).
    return { status: result.replayed ? 200 : 201, body: result };
  });

  router.add("GET", "/v0/users/:userId/training-environments", async ({ params }) => ({
    body: { periods: await services.continuity.listEnvironmentPeriods(params["userId"]!) },
  }));

  router.add(
    "GET",
    "/v0/users/:userId/training-environments/active",
    async ({ params, query }) => {
      const asOf = queryCalendarDate(query, "asOf") ?? new Date().toISOString().slice(0, 10);
      return {
        body: { environment: await services.continuity.resolveEnvironment(params["userId"]!, asOf) },
      };
    },
  );

  router.add(
    "POST",
    "/v0/users/:userId/training-environments/restore",
    async ({ params, body }) => {
      const asOf = optionalDate(body, "asOf") ?? new Date().toISOString().slice(0, 10);
      return {
        body: await services.continuity.restoreEnvironment(params["userId"]!, { asOf }),
      };
    },
  );

  router.add("GET", "/v0/users/:userId/training-continuity", async ({ params, query }) => {
    const asOf = queryCalendarDate(query, "asOf");
    return {
      body: await services.continuity.continuity(params["userId"]!, {
        ...(asOf !== undefined ? { asOf } : {}),
      }),
    };
  });

  // Generate a TEMPORARY environment-adapted plan from the active primary
  // plan (§15). The primary plan itself is never touched (§21).
  router.add(
    "POST",
    "/v0/users/:userId/training-plans/generate-temporary",
    async ({ params, body }) => {
      const parsed = parseGenerationCommand(body);
      const { planId: _planId, ...command } = parsed;
      const effectiveUntil = optionalDate(body, "effectiveUntil");
      const result = await services.planner.generateTemporaryPlan(params["userId"]!, {
        ...command,
        ...(effectiveUntil !== undefined ? { effectiveUntil } : {}),
      });
      const created = result.needed && result.result?.plan !== undefined;
      return { status: created ? 201 : 200, body: result };
    },
  );

  // -------------------------------------------------------------------------
  // Performance history + progression ledger (Phase 3.1 §3–§11)
  // -------------------------------------------------------------------------

  router.add("GET", "/v0/users/:userId/performance-history", async ({ params, query }) => {
    const exerciseId = query.get("exerciseId");
    if (exerciseId && !/^[0-9a-fA-F-]{36}$/.test(exerciseId)) {
      throw new RouteError(400, "validation_failed", "query parameter exerciseId must be a UUID");
    }
    const limit = queryNumber(query, "limit", 1, 500);
    return {
      body: await services.continuity.performanceHistory(params["userId"]!, {
        ...(exerciseId ? { exerciseId } : {}),
        ...(limit !== undefined ? { limit } : {}),
      }),
    };
  });

  // Deterministic progression evaluation; idempotent on the evidence
  // fingerprint, so replaying the same evidence returns the same evaluation.
  router.add("POST", "/v0/users/:userId/progression/evaluate", async ({ params, body }) => {
    const exerciseId = requiredUuid(body, "exerciseId");
    const planId = optionalUuid(body, "planId");
    const slotId = optionalUuid(body, "slotId");
    const asOf = optionalDate(body, "asOf");
    const targetRaw = optionalPlainObject(body, "target");
    let target:
      | { repMin?: number; repMax?: number; targetRir?: number }
      | undefined;
    if (targetRaw) {
      const repMin = optionalNumber(targetRaw, "repMin", { min: 1, max: 100, integer: true });
      const repMax = optionalNumber(targetRaw, "repMax", { min: 1, max: 100, integer: true });
      const targetRir = optionalNumber(targetRaw, "targetRir", { min: 0, max: 10 });
      if (repMin !== undefined && repMax !== undefined && repMin > repMax) {
        throw new RouteError(400, "validation_failed", "target.repMin must not exceed target.repMax");
      }
      target = {
        ...(repMin !== undefined ? { repMin } : {}),
        ...(repMax !== undefined ? { repMax } : {}),
        ...(targetRir !== undefined ? { targetRir } : {}),
      };
    }
    const result = await services.continuity.evaluateProgression(params["userId"]!, {
      exerciseId,
      ...(planId !== undefined ? { planId } : {}),
      ...(slotId !== undefined ? { slotId } : {}),
      ...(asOf !== undefined ? { asOf } : {}),
      ...(target ? { target } : {}),
    });
    // "Nothing to evaluate" is a modelled outcome, not a transport failure.
    return { status: 200, body: result };
  });

  router.add("GET", "/v0/users/:userId/progression/ledger", async ({ params, query }) => {
    const exerciseId = query.get("exerciseId");
    if (exerciseId && !/^[0-9a-fA-F-]{36}$/.test(exerciseId)) {
      throw new RouteError(400, "validation_failed", "query parameter exerciseId must be a UUID");
    }
    const planId = query.get("planId");
    if (planId && !/^[0-9a-fA-F-]{36}$/.test(planId)) {
      throw new RouteError(400, "validation_failed", "query parameter planId must be a UUID");
    }
    const planVersionId = query.get("planVersionId");
    if (planVersionId && !/^[0-9a-fA-F-]{36}$/.test(planVersionId)) {
      throw new RouteError(
        400,
        "validation_failed",
        "query parameter planVersionId must be a UUID",
      );
    }
    const limit = queryNumber(query, "limit", 1, 500);
    const view = await services.continuity.getLedgerView(params["userId"]!, {
      ...(exerciseId ? { exerciseId } : {}),
      ...(planId ? { planId } : {}),
      ...(planVersionId ? { planVersionId } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    return { body: view };
  });

  // Record what the user did about a recommendation: accepted / rejected /
  // deferred, optionally with the actual change and the resulting performance.
  // The idempotency key is REQUIRED so a retry never duplicates history (§32).
  router.add(
    "POST",
    "/v0/users/:userId/progression/ledger/:evaluationId/events",
    async ({ params, body }) => {
      const evaluationId = params["evaluationId"]!;
      if (!/^[0-9a-fA-F-]{36}$/.test(evaluationId)) {
        throw new RouteError(400, "validation_failed", "evaluationId must be a UUID");
      }
      const decision = requiredEnum(body, "decision", PROGRESSION_DECISION_KINDS);
      const idempotencyKey = requiredString(body, "idempotencyKey", { maxLength: 200 });
      const reason = optionalString(body, "reason", { maxLength: 1000 });
      const evidence = optionalStringArray(body, "evidence", { maxItems: 50 });
      const actualChangeRaw = optionalPlainObject(body, "actualChange");
      const resultingPerformanceRaw = optionalPlainObject(body, "resultingPerformance");

      let actualChange: ProgressionActualChange | undefined;
      if (actualChangeRaw) {
        const changeKind = requiredEnum(
          actualChangeRaw,
          "kind",
          ["load", "added_load", "reps", "variation", "none"] as const,
        );
        const loadDeltaKg = optionalNumber(actualChangeRaw, "loadDeltaKg", { min: -1000, max: 1000 });
        const addedLoadDeltaKg = optionalNumber(actualChangeRaw, "addedLoadDeltaKg", {
          min: -1000,
          max: 1000,
        });
        const repsDelta = optionalNumber(actualChangeRaw, "repsDelta", {
          min: -1000,
          max: 1000,
          integer: true,
        });
        const fromExerciseId = optionalUuid(actualChangeRaw, "fromExerciseId");
        const toExerciseId = optionalUuid(actualChangeRaw, "toExerciseId");
        actualChange = {
          kind: changeKind,
          ...(loadDeltaKg !== undefined ? { loadDeltaKg } : {}),
          ...(addedLoadDeltaKg !== undefined ? { addedLoadDeltaKg } : {}),
          ...(repsDelta !== undefined ? { repsDelta } : {}),
          ...(fromExerciseId !== undefined ? { fromExerciseId } : {}),
          ...(toExerciseId !== undefined ? { toExerciseId } : {}),
        };
      }

      let resultingPerformance: PerformanceObservationSummary | undefined;
      if (resultingPerformanceRaw) {
        const loadKind = requiredEnum(
          resultingPerformanceRaw,
          "loadKind",
          PERFORMANCE_LOAD_KINDS,
        );
        const localDate = requiredDate(resultingPerformanceRaw, "localDate");
        const loadKg = optionalNumber(resultingPerformanceRaw, "loadKg", { min: 0, max: 1000 });
        const addedLoadKg = optionalNumber(resultingPerformanceRaw, "addedLoadKg", {
          min: 0,
          max: 1000,
        });
        const assistanceKg = optionalNumber(resultingPerformanceRaw, "assistanceKg", {
          min: 0,
          max: 1000,
        });
        const reps = optionalNumber(resultingPerformanceRaw, "reps", {
          min: 0,
          max: 1000,
          integer: true,
        });
        const rir = optionalNumber(resultingPerformanceRaw, "rir", { min: 0, max: 10 });
        const environmentKind = optionalEnum(
          resultingPerformanceRaw,
          "environmentKind",
          TRAINING_ENVIRONMENT_KINDS,
        );
        resultingPerformance = {
          loadKind,
          localDate,
          ...(loadKg !== undefined ? { loadKg } : {}),
          ...(addedLoadKg !== undefined ? { addedLoadKg } : {}),
          ...(assistanceKg !== undefined ? { assistanceKg } : {}),
          ...(reps !== undefined ? { reps } : {}),
          ...(rir !== undefined ? { rir } : {}),
          ...(environmentKind !== undefined ? { environmentKind } : {}),
        };
      }

      const result = await services.continuity.recordProgressionDecision(
        params["userId"]!,
        {
          evaluationId,
          decision,
          idempotencyKey,
          ...(reason !== undefined ? { reason } : {}),
          ...(evidence !== undefined ? { evidence } : {}),
          ...(actualChange ? { actualChange } : {}),
          ...(resultingPerformance ? { resultingPerformance } : {}),
        },
      );
      return { status: result.replayed ? 200 : 201, body: result };
    },
  );

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
  // Sleep
  // -------------------------------------------------------------------------
  router.add("POST", "/v0/users/:userId/sleep", async ({ params, body }) => {
    const userId = params["userId"]!;
    const date = optionalDate(body, "date");
    const startedAt = requiredString(body, "startedAt", { maxLength: 50 });
    const endedAt = requiredString(body, "endedAt", { maxLength: 50 });
    const timeInBedMinutes = optionalNumber(body, "timeInBedMinutes", { min: 0, max: 1440, integer: true });
    const asleepMinutes = optionalNumber(body, "asleepMinutes", { min: 0, max: 1440, integer: true });
    const efficiency = optionalNumber(body, "efficiency", { min: 0, max: 100 });
    const latencyMinutes = optionalNumber(body, "latencyMinutes", { min: 0, max: 1440, integer: true });
    const deepMinutes = optionalNumber(body, "deepMinutes", { min: 0, max: 1440, integer: true });
    const remMinutes = optionalNumber(body, "remMinutes", { min: 0, max: 1440, integer: true });
    const lightMinutes = optionalNumber(body, "lightMinutes", { min: 0, max: 1440, integer: true });
    const awakeMinutes = optionalNumber(body, "awakeMinutes", { min: 0, max: 1440, integer: true });
    const awakenings = optionalNumber(body, "awakenings", { min: 0, max: 100, integer: true });
    const source = requiredString(body, "source", { maxLength: 200 });
    const origin = optionalEnum(body, "origin", OBSERVATION_ORIGINS);
    const externalId = optionalString(body, "externalId", { maxLength: 500 });
    const confidence = requiredEnum(body, "confidence", CONFIDENCE_VALUES_ACTIVITY);
    const notes = optionalString(body, "notes", { maxLength: 4000 });

    const record = await services.sleep.record(userId, {
      ...(date !== undefined ? { date } : {}),
      startedAt,
      endedAt,
      ...(timeInBedMinutes !== undefined ? { timeInBedMinutes } : {}),
      ...(asleepMinutes !== undefined ? { asleepMinutes } : {}),
      ...(efficiency !== undefined ? { efficiency } : {}),
      ...(latencyMinutes !== undefined ? { latencyMinutes } : {}),
      ...(deepMinutes !== undefined ? { deepMinutes } : {}),
      ...(remMinutes !== undefined ? { remMinutes } : {}),
      ...(lightMinutes !== undefined ? { lightMinutes } : {}),
      ...(awakeMinutes !== undefined ? { awakeMinutes } : {}),
      ...(awakenings !== undefined ? { awakenings } : {}),
      source,
      ...(origin ? { origin } : {}),
      ...(externalId !== undefined ? { externalId } : {}),
      confidence,
      ...(notes !== undefined ? { notes } : {}),
    });
    return { status: 201, body: { sleep: record } };
  });

  router.add("GET", "/v0/users/:userId/sleep", async ({ params, query }) => {
    const limit = queryNumber(query, "limit", 1, 500);
    const from = queryCalendarDate(query, "from");
    const to = queryCalendarDate(query, "to");
    const origin = queryEnum(query, "origin", OBSERVATION_ORIGINS);
    const history = await services.sleep.history(params["userId"]!, {
      ...(limit !== undefined ? { limit } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
      ...(origin ? { origin } : {}),
    });
    return { body: { sleep: history } };
  });

  // -------------------------------------------------------------------------
  // Recovery Indicators
  // -------------------------------------------------------------------------
  router.add("POST", "/v0/users/:userId/recovery/indicators", async ({ params, body }) => {
    const userId = params["userId"]!;
    const date = optionalDate(body, "date");
    const hrvMs = optionalNumber(body, "hrvMs", { min: 0, max: 500 });
    const restingHeartRateBpm = optionalNumber(body, "restingHeartRateBpm", { min: 20, max: 150, integer: true });
    const sleepScore = optionalNumber(body, "sleepScore", { min: 0, max: 100 });
    const readinessScore = optionalNumber(body, "readinessScore", { min: 0, max: 100 });
    const muscleSoreness = optionalNumber(body, "muscleSoreness", { min: 0, max: 10 });
    const fatigue = optionalNumber(body, "fatigue", { min: 0, max: 10 });
    const sleepQuality = optionalNumber(body, "sleepQuality", { min: 0, max: 10 });
    const readinessSubjective = optionalNumber(body, "readinessSubjective", { min: 0, max: 10 });
    const source = requiredString(body, "source", { maxLength: 200 });
    const origin = optionalEnum(body, "origin", OBSERVATION_ORIGINS);
    const externalId = optionalString(body, "externalId", { maxLength: 500 });
    const confidence = requiredEnum(body, "confidence", CONFIDENCE_VALUES_ACTIVITY);
    const notes = optionalString(body, "notes", { maxLength: 4000 });

    const record = await services.recovery.record(userId, {
      ...(date !== undefined ? { date } : {}),
      ...(hrvMs !== undefined ? { hrvMs } : {}),
      ...(restingHeartRateBpm !== undefined ? { restingHeartRateBpm } : {}),
      ...(sleepScore !== undefined ? { sleepScore } : {}),
      ...(readinessScore !== undefined ? { readinessScore } : {}),
      ...(muscleSoreness !== undefined ? { muscleSoreness } : {}),
      ...(fatigue !== undefined ? { fatigue } : {}),
      ...(sleepQuality !== undefined ? { sleepQuality } : {}),
      ...(readinessSubjective !== undefined ? { readinessSubjective } : {}),
      source,
      ...(origin ? { origin } : {}),
      ...(externalId !== undefined ? { externalId } : {}),
      confidence,
      ...(notes !== undefined ? { notes } : {}),
    });
    return { status: 201, body: { indicator: record } };
  });

  router.add("GET", "/v0/users/:userId/recovery/indicators", async ({ params, query }) => {
    const limit = queryNumber(query, "limit", 1, 500);
    const from = queryCalendarDate(query, "from");
    const to = queryCalendarDate(query, "to");
    const origin = queryEnum(query, "origin", OBSERVATION_ORIGINS);
    const history = await services.recovery.history(params["userId"]!, {
      ...(limit !== undefined ? { limit } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
      ...(origin ? { origin } : {}),
    });
    return { body: { indicators: history } };
  });

  // -------------------------------------------------------------------------
  // Activity Intelligence (derived state)
  // -------------------------------------------------------------------------
  router.add("GET", "/v0/users/:userId/activity/daily", async ({ params, query }) => {
    const userId = params["userId"]!;
    const from = queryCalendarDate(query, "from");
    const to = queryCalendarDate(query, "to");
    if (!from || !to) {
      throw new RouteError(400, "validation_failed", "query parameters from and to are required (YYYY-MM-DD)");
    }
    const summaries = await services.activityIntelligence.getDailySummaries(userId, from, to);
    return { body: { dailySummaries: summaries } };
  });

  router.add("GET", "/v0/users/:userId/activity/targets", async ({ params }) => {
    const targets = await services.activityIntelligence.getActivityTargets(params["userId"]!);
    return { body: { targets } };
  });

  router.add("GET", "/v0/users/:userId/activity/context", async ({ params, query }) => {
    const windowDays = queryNumber(query, "windowDays", 1, 90) ?? 14;
    const context = await services.activityIntelligence.getActivityContext(params["userId"]!, windowDays);
    return { body: { context } };
  });

  // -------------------------------------------------------------------------
  // Recovery Intelligence (derived state)
  // -------------------------------------------------------------------------
  router.add("GET", "/v0/users/:userId/recovery/state", async ({ params }) => {
    const state = await services.recoveryIntelligence.getRecoveryState(params["userId"]!);
    return { body: { state } };
  });

  router.add("GET", "/v0/users/:userId/recovery/trends", async ({ params, query }) => {
    const windowDays = queryNumber(query, "windowDays", 1, 90) ?? 14;
    const signals = await services.recoveryIntelligence.getRecoveryPlateauSignals(params["userId"]!);
    return { body: { signals, windowDays } };
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

  // -------------------------------------------------------------------------
  // Food Search
  // -------------------------------------------------------------------------
  router.add("GET", "/v0/foods/search", async ({ query }) => {
    const q = query.get("q");
    if (!q || q.length < 2) {
      throw new RouteError(400, "validation_failed", "query parameter q must be at least 2 characters");
    }
    const limit = Math.min(queryNumber(query, "limit", 1, Number.MAX_SAFE_INTEGER) ?? 20, 100);
    const offset = queryNumber(query, "offset", 0, 10000) ?? 0;
    const sourceId = query.get("sourceId") ?? undefined;

    const result = await services.nutrition.searchFoods(q, { limit, offset, sourceId });
    return { body: result };
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
  // Recipes
  // -------------------------------------------------------------------------
  function parseRecipeItems(body: Record<string, unknown>): Array<{
    foodId: string;
    quantityGrams: number;
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
      const notes = optionalString(item, `items[${index}].notes`, { maxLength: 2000 });
      return { foodId, quantityGrams, ...(notes !== undefined ? { notes } : {}) };
    });
  }

  router.add("POST", "/v0/users/:userId/recipes", async ({ params, body }) => {
    const userId = params["userId"]!;
    const name = requiredString(body, "name", { maxLength: 300 });
    const servings = requiredNumber(body, "servings", { min: 1, max: 1000, integer: true });
    const instructions = optionalString(body, "instructions", { maxLength: 10000 });
    const items = parseRecipeItems(body);

    const recipe = await services.recipes.createRecipe(userId, {
      name,
      servings,
      ...(instructions !== undefined ? { instructions } : {}),
      items,
    });
    return { status: 201, body: { recipe } };
  });

  router.add("GET", "/v0/users/:userId/recipes", async ({ params }) => ({
    body: { recipes: await services.recipes.listRecipes(params["userId"]!) },
  }));

  router.add("GET", "/v0/recipes/:recipeId", async ({ params }) => ({
    body: { recipe: await services.recipes.getRecipe(params["recipeId"]!) },
  }));

  router.add("DELETE", "/v0/recipes/:recipeId", async ({ params }) => {
    await services.recipes.deleteRecipe(params["recipeId"]!);
    return { status: 204, body: {} };
  });

  router.add("GET", "/v0/recipes/:recipeId/nutrition", async ({ params, query }) => {
    const servings = queryNumber(query, "servings", 0.01, 1000);
    if (servings === undefined) {
      throw new RouteError(400, "validation_failed", "query parameter servings is required");
    }
    const nutrition = await services.recipes.computeRecipeNutrition(params["recipeId"]!, servings);
    return { body: { nutrition } };
  });

  // -------------------------------------------------------------------------
  // Nutrition Targets
  // -------------------------------------------------------------------------
  router.add("POST", "/v0/users/:userId/nutrition/targets", async ({ params, body }) => {
    const userId = params["userId"]!;
    const kind = requiredEnum(body, "goal", GOAL_KINDS);
    const currentBodyWeightKg = optionalNumber(body, "currentBodyWeightKg", { min: 1, max: 500 });
    const bodyFatPercent = optionalNumber(body, "bodyFatPercent", { min: 0, max: 60 });

    const targets = await services.nutritionTargets.deriveAndStoreTargets(userId, { kind }, {
      currentBodyWeightKg,
      bodyFatPercent,
    });
    return { status: 201, body: { targets } };
  });

  router.add("GET", "/v0/users/:userId/nutrition/targets", async ({ params }) => {
    const targets = await services.nutritionTargets.getTargets(params["userId"]!);
    if (!targets) throw new RouteError(404, "not_found", "no nutrition targets found");
    return { body: { targets } };
  });

  // -------------------------------------------------------------------------
  // Nutrition Assessment
  // -------------------------------------------------------------------------
  router.add("GET", "/v0/users/:userId/nutrition/assessment", async ({ params, query }) => {
    const userId = params["userId"]!;
    const windowDays = queryNumber(query, "windowDays", 1, 365);

    // First get current targets
    const targets = await services.nutritionTargets.getTargets(userId);
    if (!targets) throw new RouteError(404, "not_found", "no nutrition targets found");

    const assessment = await services.nutritionAssessment.assessAdherence(userId, targets, windowDays);
    return { body: { assessment } };
  });

  // -------------------------------------------------------------------------
  // Barcode Scanner
  // -------------------------------------------------------------------------
  router.add("GET", "/v0/barcode/lookup", async ({ query }) => {
    const barcode = query.get("barcode");
    if (!barcode || !BARCODE_PATTERN.test(barcode)) {
      throw new RouteError(400, "validation_failed", "query parameter barcode must be a valid EAN/UPC code (8-14 digits)");
    }

    const result = await services.barcode.lookupBarcode(barcode);
    return { body: result };
  });

  router.add("GET", "/v0/barcode/preview", async ({ query }) => {
    const barcode = query.get("barcode");
    if (!barcode || !BARCODE_PATTERN.test(barcode)) {
      throw new RouteError(400, "validation_failed", "query parameter barcode must be a valid EAN/UPC code (8-14 digits)");
    }
    const servingGramsRaw = query.get("servingGrams");
    if (!servingGramsRaw) {
      throw new RouteError(400, "validation_failed", "query parameter servingGrams is required");
    }
    const servingGrams = Number(servingGramsRaw);
    if (!Number.isFinite(servingGrams) || servingGrams <= 0 || servingGrams > 10000) {
      throw new RouteError(400, "validation_failed", "servingGrams must be a positive number <= 10000");
    }

    const userId = query.get("userId");
    if (!userId) {
      throw new RouteError(401, "unauthorized", "query parameter userId is required for personalized assessment");
    }

    const result = await services.barcode.getProductPreview(barcode, servingGrams, userId);
    return { body: result };
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
  // Unified Decision Brain (Phase 8)
  //
  // End-to-end unified decision lifecycle: state construction → diagnosis →
  // intervention selection → persistence → outcome evaluation.
  // -------------------------------------------------------------------------

  router.add(
    "POST",
    "/v0/users/:userId/decisions",
    async ({ params, body }) => {
      const userId = params["userId"]!;
      const asOf = optionalDate(body, "asOf");
      const forceReevaluate = optionalBoolean(body, "forceReevaluate");
      const assumptionOverrides = optionalPlainObject(body, "assumptionOverrides");

      const result = await services.unifiedDecision.generateDecision({
        userId,
        ...(asOf !== undefined ? { asOf } : {}),
        ...(forceReevaluate !== undefined ? { forceReevaluate } : {}),
        ...(assumptionOverrides ? { assumptionOverrides: assumptionOverrides as Record<string, string> } : {}),
      });

      return {
        status: result.isNew ? 201 : 200,
        body: {
          snapshot: result.snapshot,
          isNew: result.isNew,
          previousSnapshot: result.previousSnapshot,
          unifiedState: result.unifiedState,
          diagnoses: result.diagnoses,
          interventions: result.interventions,
        }
      };
    },
  );

  router.add("GET", "/v0/users/:userId/decisions", async ({ params, query }) => {
    const userId = params["userId"]!;
    const status = query.get("status") as DecisionSnapshotStatus | undefined;
    const limit = queryNumber(query, "limit", 1, 100);
    const cursor = query.get("cursor");

    const decisions = await services.unifiedDecision.listDecisions(userId, {
      ...(status ? { status } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(cursor ? { cursor } : {}),
    });

    return { body: { decisions } };
  });

  router.add("GET", "/v0/users/:userId/decisions/current", async ({ params }) => {
    const userId = params["userId"]!;
    const decision = await services.unifiedDecision.getCurrentDecision(userId);
    return { body: { decision } };
  });

  router.add("GET", "/v0/users/:userId/decisions/:decisionId", async ({ params }) => {
    const userId = params["userId"]!;
    const decision = await services.unifiedDecision.getDecision(userId, params["decisionId"]!);
    if (!decision) {
      throw new RouteError(404, "not_found", "Decision not found");
    }
    return { body: { decision } };
  });

  router.add(
    "POST",
    "/v0/users/:userId/decisions/:decisionId/outcomes",
    async ({ params, body }) => {
      const userId = params["userId"]!;
      const decisionId = params["decisionId"]!;
      const evaluationWindow = requiredString(body, "evaluationWindow", { maxLength: 100 });
      const verdict = requiredEnum(body, "verdict", [
        "improved_as_expected",
        "partially_improved",
        "no_effect",
        "worsened",
        "uncertain",
        "too_early",
      ]);
      const observations = optionalStringArray(body, "observations", { maxItems: 50, maxLength: 1000 });
      const explanation = requiredString(body, "explanation", { maxLength: 8000 });
      const followUpDiagnosisIds = optionalStringArray(body, "followUpDiagnosisIds", { maxItems: 20, maxLength: 100 });
      const triggersReevaluation = optionalBoolean(body, "triggersReevaluation");
      const evaluatedAt = optionalTimestamp(body, "evaluatedAt");
      const interventionVerdictsRaw = optionalObjectArray(body, "interventionVerdicts", { maxItems: 20 }) ?? [];
      const interventionVerdicts = interventionVerdictsRaw.map((item, index) => ({
        interventionIndex: requiredNumber(item, `interventionVerdicts[${index}].interventionIndex`, { integer: true, min: 0 }),
        verdict: requiredEnum(item, `interventionVerdicts[${index}].verdict`, [
          "improved_as_expected",
          "partially_improved",
          "no_effect",
          "worsened",
          "uncertain",
          "too_early",
        ]),
        observations: optionalStringArray(item, `interventionVerdicts[${index}].observations`, { maxItems: 20, maxLength: 500 }) ?? [],
      }));

      const outcome = await services.unifiedDecision.recordDecisionOutcome(userId, decisionId, {
        evaluationWindow,
        verdict,
        observations: observations ?? [],
        explanation,
        followUpDiagnosisIds: followUpDiagnosisIds ?? [],
        triggersReevaluation: triggersReevaluation ?? false,
        evaluatedAt,
        interventionVerdicts: interventionVerdicts ?? [],
      });

      return { status: 201, body: { outcome } };
    },
  );

  router.add("GET", "/v0/users/:userId/decisions/:decisionId/outcomes", async ({ params, query }) => {
    const userId = params["userId"]!;
    const decisionId = params["decisionId"]!;
    const queryObj = queryToObject(query);
    const evaluationWindow = optionalString(queryObj, "evaluationWindow", { maxLength: 100 });
    const limit = queryNumber(query, "limit", 1, 50);

    const outcomes = await services.unifiedDecision.listDecisionOutcomes(userId, decisionId, {
      ...(evaluationWindow ? { evaluationWindow } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });

    return { body: { outcomes } };
  });

  router.add("GET", "/v0/users/:userId/decisions/:decisionId/reevaluate", async ({ params }) => {
    const userId = params["userId"]!;
    const decisionId = params["decisionId"]!;

    const result = await services.unifiedDecision.shouldReevaluateDecision(userId, decisionId);
    return { body: { should: result.should, reason: result.reason } };
  });

  router.add("GET", "/v0/users/:userId/unified-state", async ({ params, query }) => {
    const userId = params["userId"]!;
    const asOf = queryCalendarDate(query, "asOf");

    const unifiedState = await services.unifiedDecision.buildUnifiedStateForUser(userId, asOf ?? (new Date().toISOString().split("T")[0] as any));

    return { body: { unifiedState } };
  });

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

// -------------------------------------------------------------------------
// Body Intelligence (Phase 7)
// -------------------------------------------------------------------------

const PHYSIQUE_PRIORITY_TAGS = [
  "upper_body",
  "lower_body",
  "push_muscles",
  "pull_muscles",
  "legs",
  "glutes",
  "core",
  "shoulder_width",
  "waist_proportion",
  "arm_size",
  "leg_size",
  "back_width",
  "chest_development",
  "symmetry",
  "proportion",
  "overall_mass",
  "leanness",
  "custom",
] as const;

const GOAL_DIRECTIONS = ["maintain", "gain", "lose", "recomp"] as const;

router.add("POST", "/v0/users/:userId/physique-goals", async ({ params, body }) => {
  const userId = params["userId"]!;
  const priorities = requiredStringArray(body, "priorities", { maxItems: 20, maxLength: 100 });
  if (priorities.length === 0) {
    throw new RouteError(400, "validation_failed", "priorities must be a non-empty array");
  }
  for (const p of priorities) {
    if (!PHYSIQUE_PRIORITY_TAGS.includes(p as (typeof PHYSIQUE_PRIORITY_TAGS)[number])) {
      throw new RouteError(400, "validation_failed", `invalid priority tag: ${p}`);
    }
  }
  const customPrioritiesRaw = optionalObjectArray(body, "customPriorities", { maxItems: 10 });
  const customPriorities = customPrioritiesRaw?.map((item, index) => ({
    tag: requiredString(item, `customPriorities[${index}].tag`, { maxLength: 100 }),
    label: requiredString(item, `customPriorities[${index}].label`, { maxLength: 200 }),
  }));
  const targetTimeframeWeeks = optionalNumber(body, "targetTimeframeWeeks", { min: 1, max: 104, integer: true });
  const direction = optionalEnum(body, "direction", GOAL_DIRECTIONS);

  const goal = await services.bodyIntelligence.createPhysiqueGoal(userId, {
    userId,
    priorities: priorities as any,
    customPriorities,
    targetTimeframeWeeks,
    direction,
  });
  return { status: 201, body: { goal } };
});

router.add("GET", "/v0/users/:userId/physique-goals", async ({ params }) => {
  const goal = await services.bodyIntelligence.getPhysiqueGoal(params["userId"]!);
  if (!goal) {
    // Return default based on active training goal
    const activeGoal = await services.goals.active(params["userId"]!);
    if (activeGoal) {
      const defaultGoal = services.bodyIntelligence.getDefaultPhysiqueGoal(params["userId"]!, activeGoal.kind);
      return { body: { goal: defaultGoal, isDefault: true } };
    }
    throw new RouteError(404, "not_found", "no physique goal set and no active training goal");
  }
  return { body: { goal, isDefault: false } };
});

router.add("PUT", "/v0/users/:userId/physique-goals", async ({ params, body }) => {
  const updates: Partial<{
    priorities: readonly import("@fitcoach/fitness-core").PhysiquePriorityTag[];
    customPriorities: readonly { tag: string; label: string }[];
    targetTimeframeWeeks: number;
    direction: "maintain" | "gain" | "lose" | "recomp";
  }> = {};
  const priorities = optionalStringArray(body, "priorities", { maxItems: 20, maxLength: 100 });
  if (priorities) {
    for (const p of priorities) {
      if (!PHYSIQUE_PRIORITY_TAGS.includes(p as (typeof PHYSIQUE_PRIORITY_TAGS)[number])) {
        throw new RouteError(400, "validation_failed", `invalid priority tag: ${p}`);
      }
    }
    updates.priorities = priorities as import("@fitcoach/fitness-core").PhysiquePriorityTag[];
  }
  const customPrioritiesRaw = optionalObjectArray(body, "customPriorities", { maxItems: 10 });
  if (customPrioritiesRaw) {
    updates.customPriorities = customPrioritiesRaw.map((item, index) => ({
      tag: requiredString(item, `customPriorities[${index}].tag`, { maxLength: 100 }),
      label: requiredString(item, `customPriorities[${index}].label`, { maxLength: 200 }),
    }));
  }
  const targetTimeframeWeeks = optionalNumber(body, "targetTimeframeWeeks", { min: 1, max: 104, integer: true });
  if (targetTimeframeWeeks !== undefined) updates.targetTimeframeWeeks = targetTimeframeWeeks;
  const direction = optionalEnum(body, "direction", GOAL_DIRECTIONS);
  if (direction) updates.direction = direction;

  const goal = await services.bodyIntelligence.updatePhysiqueGoal(params["userId"]!, updates);
  return { body: { goal } };
});

router.add("DELETE", "/v0/users/:userId/physique-goals", async ({ params }) => {
  await services.bodyIntelligence.deletePhysiqueGoal(params["userId"]!);
  return { status: 204, body: {} };
});

router.add("GET", "/v0/users/:userId/body/assessment", async ({ params, query }) => {
  const userId = params["userId"]!;
  const asOf = queryCalendarDate(query, "asOf");
  const assessment = await services.bodyIntelligence.getBodyAssessment(userId, asOf);
  return { body: { assessment } };
});

router.add("GET", "/v0/users/:userId/body/measurements/analysis", async ({ params }) => {
  const userId = params["userId"]!;
  const profile = await services.profiles.get(userId);
  if (!profile || !profile.heightCm || !profile.sex) {
    throw new RouteError(400, "validation_failed", "profile must have heightCm and sex set");
  }
  const analysis = await services.bodyIntelligence.getMeasurementAnalysis(userId, profile.heightCm, profile.sex as "male" | "female");
  return { body: { analysis } };
});

router.add("GET", "/v0/users/:userId/body/muscle-development", async ({ params }) => {
  const analysis = await services.bodyIntelligence.getMuscleDevelopmentAnalysis(params["userId"]!);
  return { body: { analysis } };
});

router.add("GET", "/v0/users/:userId/body/disproportionate", async ({ params }) => {
  const analysis = await services.bodyIntelligence.getDisproportionateAnalysis(params["userId"]!);
  return { body: { analysis } };
});

router.add("GET", "/v0/users/:userId/body/recommendations", async ({ params }) => {
  const recommendations = await services.bodyIntelligence.getBodyRecommendations(params["userId"]!);
  return { body: { recommendations } };
});

router.add("GET", "/v0/users/:userId/body/integration-context", async ({ params }) => {
  const context = await services.bodyIntelligence.getBodyContextForIntegration(params["userId"]!);
  return { body: { context } };
});

// -------------------------------------------------------------------------
// AI Coach conversations (Phase 9.3)
//
// Evidence-grounded coaching pipeline: orchestration → context builder →
// decision brain → mock AI provider → validator → persistence.
//
// WARNING (security): there is no authentication layer yet. The userId in
// the URL is trusted exactly as supplied by the client, so these routes are
// NOT secure and MUST NOT be treated as authorized endpoints. Ownership is
// enforced at the route/service level (a user can only touch their own
// conversations and messages), but the userId itself is unauthenticated.
// -------------------------------------------------------------------------

router.add(
  "POST",
  "/v0/users/:userId/conversations",
  coachingHandler(async ({ params, body }: { params: Record<string, string>; body: Record<string, unknown> }) => {
    const userId = params["userId"]!;
    const title = optionalString(body, "title", { maxLength: 200 });
    const conversation = await services.aiCoaching.createConversation(userId, {
      ...(title !== undefined ? { title } : {}),
    });
    return { status: 201, body: { conversation } };
  }),
);

router.add(
  "GET",
  "/v0/users/:userId/conversations",
  coachingHandler(async ({ params, query }: { params: Record<string, string>; query: URLSearchParams }) => {
    const limit = queryNumber(query, "limit", 1, 100);
    const cursor = query.get("cursor") ?? undefined;
    const conversations = await services.aiCoaching.listConversations(params["userId"]!, {
      ...(limit !== undefined ? { limit } : {}),
      ...(cursor ? { cursor } : {}),
    });
    return { body: { conversations } };
  }),
);

router.add(
  "GET",
  "/v0/users/:userId/conversations/:conversationId/messages",
  coachingHandler(async ({ params, query }: { params: Record<string, string>; query: URLSearchParams }) => {
    const limit = queryNumber(query, "limit", 1, 100);
    const messages = await services.aiCoaching.listMessages(
      params["conversationId"]!,
      params["userId"]!,
      limit !== undefined ? { limit } : {},
    );
    return { body: { messages } };
  }),
);

router.add(
  "POST",
  "/v0/users/:userId/conversations/:conversationId/messages",
  coachingHandler(async ({ params, body }: { params: Record<string, string>; body: Record<string, unknown> }) => {
    const userId = params["userId"]!;
    const conversationId = params["conversationId"]!;
    const message = requiredString(body, "message", { maxLength: 4000 });
    const asOf = optionalDate(body, "asOf");
    const intentRaw = optionalPlainObject(body, "intent");

    const coachingRequest: CoachingRequest = {
      userId,
      conversationId,
      message,
      ...(asOf !== undefined ? { asOf } : {}),
      ...(intentRaw ? { intent: intentRaw as unknown as IntentClassification } : {}),
      // Source selection is driven by the classified intent (the builder
      // defaults to all sources when the intent is uncertain); callers must
      // not override it, or the sufficiency gate would be evaluated against
      // sources the question does not need.
    };

    const response = await services.aiCoaching.handleCoachingRequest(coachingRequest);
    return { status: 200, body: response };
  }),
);

router.add(
  "GET",
  "/v0/users/:userId/messages/:messageId",
  coachingHandler(async ({ params }: { params: Record<string, string> }) => {
    const message = await services.aiCoaching.getMessage(
      params["messageId"]!,
      params["userId"]!,
    );
    return { body: { message } };
  }),
);

router.add(
  "POST",
  "/v0/users/:userId/conversations/:conversationId/messages/:messageId/actions/:actionId/preview",
  coachingHandler(async ({ params }: { params: Record<string, string> }) => {
    const { record, preview } = await services.aiCoaching.previewAction(
      params["actionId"]!,
      params["userId"]!,
    );
    return { body: { action: record, preview } };
  }),
);

router.add(
  "POST",
  "/v0/users/:userId/conversations/:conversationId/messages/:messageId/actions/:actionId/confirm",
  coachingHandler(async ({ params }: { params: Record<string, string> }) => {
    const result = await services.aiCoaching.confirmAction(
      params["actionId"]!,
      params["userId"]!,
    );
    return { body: result };
  }),
);

router.add(
  "POST",
  "/v0/users/:userId/conversations/:conversationId/messages/:messageId/actions/:actionId/reject",
  coachingHandler(async ({ params }: { params: Record<string, string> }) => {
    const result = await services.aiCoaching.rejectAction(
      params["actionId"]!,
      params["userId"]!,
    );
    return { body: result };
  }),
);
}
