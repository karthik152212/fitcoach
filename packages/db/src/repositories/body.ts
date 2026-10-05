import type { PrismaClient } from "@prisma/client";
import type {
  ActivityKind,
  BodySite,
  CalendarDate,
  EffortLevel,
  MeasurementCondition,
  Timestamp,
} from "@fitcoach/domain";
import { ConstraintValidationError, NotFoundError } from "../errors";
import { newUuidv7 } from "../ids";
import { decimalToNumber, toCalendarDate, toTimestamp } from "../mapping";
import { boundedLimit, runDb } from "./util";

// ---------------------------------------------------------------------------
// Body measurements (immutable observations, §9)
// ---------------------------------------------------------------------------

type MeasurementConfidence = "measured" | "estimated" | "unknown";
type MeasurementEntry = "manual" | "smart_scale_import" | "wearable_import" | "other";

interface MeasurementRow {
  id: string;
  userId: string;
  recordedAt: Date;
  condition: string | null;
  bodyWeightKg: unknown;
  bodyFatPercent: unknown;
  enteredVia: string | null;
  confidence: string | null;
  sourceName: string | null;
  externalId: string | null;
  photoRefs: string[] | null;
  notes: string | null;
  createdAt: Date;
}

interface MeasurementValueRow {
  measurementId: string;
  site: string;
  valueCm: unknown;
}

export interface BodyMeasurementRecord {
  id: string;
  userId: string;
  recordedAt: Timestamp;
  condition?: MeasurementCondition;
  bodyWeightKg?: number;
  bodyFatPercent?: number;
  circumferencesCm: Partial<Record<BodySite, number>>;
  enteredVia?: MeasurementEntry;
  confidence?: MeasurementConfidence;
  sourceName?: string;
  externalId?: string;
  photoRefs: string[];
  notes?: string;
  createdAt: string;
}

interface MeasurementRowWithValues extends MeasurementRow {
  values: MeasurementValueRow[];
}

function measurementRowToRecord(row: MeasurementRowWithValues): BodyMeasurementRecord {
  const circumferences: Partial<Record<BodySite, number>> = {};
  for (const value of row.values) {
    const cm = decimalToNumber(value.valueCm);
    if (cm !== undefined) circumferences[value.site as BodySite] = cm;
  }
  return {
    id: row.id,
    userId: row.userId,
    recordedAt: toTimestamp(row.recordedAt),
    condition: (row.condition ?? undefined) as MeasurementCondition | undefined,
    bodyWeightKg: decimalToNumber(row.bodyWeightKg),
    bodyFatPercent: decimalToNumber(row.bodyFatPercent),
    circumferencesCm: circumferences,
    enteredVia: (row.enteredVia ?? undefined) as MeasurementEntry | undefined,
    confidence: (row.confidence ?? undefined) as MeasurementConfidence | undefined,
    sourceName: row.sourceName ?? undefined,
    externalId: row.externalId ?? undefined,
    photoRefs: row.photoRefs ?? [],
    notes: row.notes ?? undefined,
    createdAt: toTimestamp(row.createdAt),
  };
}

const MEASUREMENT_INCLUDE = { values: true } as const;

export interface RecordMeasurementInput {
  id?: string;
  userId: string;
  /** True measurement time; defaults to now (distinct from logging time). */
  recordedAt?: Timestamp;
  condition?: MeasurementCondition;
  bodyWeightKg?: number;
  bodyFatPercent?: number;
  circumferencesCm?: Partial<Record<BodySite, number>>;
  enteredVia?: MeasurementEntry;
  confidence?: MeasurementConfidence;
  sourceName?: string;
  /** Provider event id — repeated imports never duplicate (§15). */
  externalId?: string;
  photoRefs?: readonly string[];
  notes?: string;
}

export interface MeasurementHistoryQuery {
  limit?: number;
  from?: Timestamp;
  to?: Timestamp;
}

export interface BodyMeasurementRepository {
  /** Append-only. Idempotent on (userId, enteredVia, externalId). */
  record(input: RecordMeasurementInput): Promise<BodyMeasurementRecord>;
  history(userId: string, query?: MeasurementHistoryQuery): Promise<BodyMeasurementRecord[]>;
}

export class PrismaBodyMeasurementRepository implements BodyMeasurementRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(input: RecordMeasurementInput): Promise<BodyMeasurementRecord> {
    const hasDatum =
      input.bodyWeightKg !== undefined ||
      input.bodyFatPercent !== undefined ||
      (input.circumferencesCm !== undefined && Object.keys(input.circumferencesCm).length > 0);
    if (!hasDatum) {
      throw new ConstraintValidationError(
        "measurement must include body weight, body fat or at least one circumference",
      );
    }

    const id = input.id ?? newUuidv7();
    return runDb(async () => {
      if (input.externalId && input.enteredVia) {
        const existing = await this.prisma.bodyMeasurement.findFirst({
          where: {
            userId: input.userId,
            enteredVia: input.enteredVia,
            externalId: input.externalId,
          },
          include: MEASUREMENT_INCLUDE,
        });
        if (existing) return measurementRowToRecord(existing);
      }

      try {
        const row = await this.prisma.bodyMeasurement.create({
          data: {
            id,
            userId: input.userId,
            recordedAt: input.recordedAt ? new Date(input.recordedAt) : new Date(),
            condition: input.condition ?? null,
            bodyWeightKg: input.bodyWeightKg ?? null,
            bodyFatPercent: input.bodyFatPercent ?? null,
            enteredVia: input.enteredVia ?? null,
            confidence: input.confidence ?? null,
            sourceName: input.sourceName ?? null,
            externalId: input.externalId ?? null,
            photoRefs: input.photoRefs ? [...input.photoRefs] : [],
            notes: input.notes ?? null,
            ...(input.circumferencesCm
              ? {
                  values: {
                    create: Object.entries(input.circumferencesCm).map(([site, valueCm]) => ({
                      site,
                      valueCm: valueCm as number,
                    })),
                  },
                }
              : {}),
          },
          include: MEASUREMENT_INCLUDE,
        });
        return measurementRowToRecord(row);
      } catch (error) {
        if (
          input.externalId &&
          typeof error === "object" &&
          error !== null &&
          (error as { code?: string }).code === "P2002"
        ) {
          const existing = await this.prisma.bodyMeasurement.findFirst({
            where: {
              userId: input.userId,
              externalId: input.externalId,
              ...(input.enteredVia ? { enteredVia: input.enteredVia } : {}),
            },
            include: MEASUREMENT_INCLUDE,
          });
          if (existing) return measurementRowToRecord(existing);
        }
        throw error;
      }
    });
  }

  async history(
    userId: string,
    query: MeasurementHistoryQuery = {},
  ): Promise<BodyMeasurementRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.bodyMeasurement.findMany({
        where: {
          userId,
          ...(query.from || query.to
            ? {
                recordedAt: {
                  ...(query.from ? { gte: new Date(query.from) } : {}),
                  ...(query.to ? { lte: new Date(query.to) } : {}),
                },
              }
            : {}),
        },
        include: MEASUREMENT_INCLUDE,
        orderBy: { recordedAt: "desc" },
        take: boundedLimit(query.limit, 100),
      });
      return rows.map(measurementRowToRecord);
    });
  }
}

// ---------------------------------------------------------------------------
// Activity (append-only observations; steps upsert is the sanctioned
// mutation, §15)
// ---------------------------------------------------------------------------

interface ActivityRow {
  id: string;
  userId: string;
  date: Date;
  kind: string;
  steps: number | null;
  durationMinutes: number | null;
  distanceKm: unknown;
  averageHeartRateBpm: number | null;
  estimatedCaloriesBurned: unknown;
  effort: string | null;
  recordedVia: string | null;
  externalId: string | null;
  notes: string | null;
  createdAt: Date;
}

export interface ActivityRecordRow {
  id: string;
  userId: string;
  /** User-local day. */
  date: CalendarDate;
  kind: ActivityKind;
  steps?: number;
  durationMinutes?: number;
  distanceKm?: number;
  averageHeartRateBpm?: number;
  estimatedCaloriesBurned?: number;
  effort?: EffortLevel;
  recordedVia?: string;
  externalId?: string;
  notes?: string;
  createdAt: string;
}

function activityRowToRecord(row: ActivityRow): ActivityRecordRow {
  return {
    id: row.id,
    userId: row.userId,
    date: toCalendarDate(row.date),
    kind: row.kind as ActivityKind,
    steps: row.steps ?? undefined,
    durationMinutes: row.durationMinutes ?? undefined,
    distanceKm: decimalToNumber(row.distanceKm),
    averageHeartRateBpm: row.averageHeartRateBpm ?? undefined,
    estimatedCaloriesBurned: decimalToNumber(row.estimatedCaloriesBurned),
    effort: (row.effort ?? undefined) as EffortLevel | undefined,
    recordedVia: row.recordedVia ?? undefined,
    externalId: row.externalId ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: toTimestamp(row.createdAt),
  };
}

export interface RecordStepsInput {
  id?: string;
  userId: string;
  date: CalendarDate;
  steps: number;
  recordedVia?: string;
  externalId?: string;
  notes?: string;
}

export interface RecordActivityInput {
  id?: string;
  userId: string;
  date: CalendarDate;
  kind: Exclude<ActivityKind, "steps">;
  durationMinutes?: number;
  distanceKm?: number;
  averageHeartRateBpm?: number;
  estimatedCaloriesBurned?: number;
  effort?: EffortLevel;
  recordedVia?: string;
  externalId?: string;
  notes?: string;
}

export interface ActivityHistoryQuery {
  kind?: ActivityKind;
  limit?: number;
  from?: CalendarDate;
  to?: CalendarDate;
}

export interface ActivityRepository {
  /**
   * Cumulative daily steps. Race-free idempotent upsert: one row per
   * (user, local day, source); the maximum cumulative value wins (§15).
   */
  recordSteps(input: RecordStepsInput): Promise<ActivityRecordRow>;
  /** Discrete cardio sessions; app-level dedupe on externalId. */
  record(input: RecordActivityInput): Promise<ActivityRecordRow>;
  history(userId: string, query?: ActivityHistoryQuery): Promise<ActivityRecordRow[]>;
}

function parseDay(value: CalendarDate, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ConstraintValidationError(`${field} must be YYYY-MM-DD`);
  }
  return new Date(`${value}T00:00:00.000Z`);
}

/** Raw $queryRaw results arrive with snake_case column names. */
interface RawActivityRow {
  id: string;
  user_id: string;
  date: Date;
  kind: string;
  steps: number | null;
  duration_minutes: number | null;
  distance_km: unknown;
  average_heart_rate_bpm: number | null;
  estimated_calories_burned: unknown;
  effort: string | null;
  recorded_via: string | null;
  external_id: string | null;
  notes: string | null;
  created_at: Date;
}

function rawActivityRowToRecord(row: RawActivityRow): ActivityRecordRow {
  return {
    id: row.id,
    userId: row.user_id,
    date: toCalendarDate(row.date),
    kind: row.kind as ActivityKind,
    steps: row.steps ?? undefined,
    durationMinutes: row.duration_minutes ?? undefined,
    distanceKm: decimalToNumber(row.distance_km),
    averageHeartRateBpm: row.average_heart_rate_bpm ?? undefined,
    estimatedCaloriesBurned: decimalToNumber(row.estimated_calories_burned),
    effort: (row.effort ?? undefined) as EffortLevel | undefined,
    recordedVia: row.recorded_via ?? undefined,
    externalId: row.external_id ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: toTimestamp(row.created_at),
  };
}

export class PrismaActivityRepository implements ActivityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async recordSteps(input: RecordStepsInput): Promise<ActivityRecordRow> {
    if (!Number.isInteger(input.steps) || input.steps < 0) {
      throw new ConstraintValidationError("steps must be a non-negative integer");
    }
    const date = parseDay(input.date, "date");
    const id = input.id ?? newUuidv7();
    const recordedVia = input.recordedVia ?? null;

    return runDb(async () => {
      // Expression conflict target matches the partial unique index
      // activity_records_steps_source_day_unique exactly (§15).
      const inserted = await this.prisma.$queryRaw<RawActivityRow[]>`
        INSERT INTO "activity_records"
          ("id", "user_id", "date", "kind", "steps", "recorded_via", "external_id", "notes")
        VALUES
          (${id}::uuid, ${input.userId}::uuid, ${date}::date, 'steps', ${input.steps}::int,
           ${recordedVia}, ${input.externalId ?? null}, ${input.notes ?? null})
        ON CONFLICT ("user_id", "date", COALESCE("recorded_via", ''))
          WHERE "kind" = 'steps'
        DO UPDATE SET "steps" = EXCLUDED."steps"
          WHERE EXCLUDED."steps" > "activity_records"."steps"
        RETURNING *`;

      if (inserted.length > 0) return rawActivityRowToRecord(inserted[0]!);

      // Conflict with an equal-or-higher cumulative value: return current row.
      const existing = await this.prisma.activityRecord.findFirst({
        where: {
          userId: input.userId,
          date,
          kind: "steps",
          recordedVia: input.recordedVia ?? null,
        },
      });
      if (!existing) {
        // Rows exist only under a different source; surface as conflict-free
        // internal inconsistency (cannot happen with matching conflict target).
        throw new NotFoundError("steps row could not be resolved");
      }
      return activityRowToRecord(existing);
    });
  }

  async record(input: RecordActivityInput): Promise<ActivityRecordRow> {
    const date = parseDay(input.date, "date");
    const id = input.id ?? newUuidv7();
    return runDb(async () => {
      if (input.externalId) {
        const existing = await this.prisma.activityRecord.findFirst({
          where: { userId: input.userId, externalId: input.externalId, kind: input.kind },
        });
        if (existing) return activityRowToRecord(existing);
      }
      const row = await this.prisma.activityRecord.create({
        data: {
          id,
          userId: input.userId,
          date,
          kind: input.kind,
          durationMinutes: input.durationMinutes ?? null,
          distanceKm: input.distanceKm ?? null,
          averageHeartRateBpm: input.averageHeartRateBpm ?? null,
          estimatedCaloriesBurned: input.estimatedCaloriesBurned ?? null,
          effort: input.effort ?? null,
          recordedVia: input.recordedVia ?? null,
          externalId: input.externalId ?? null,
          notes: input.notes ?? null,
        },
      });
      return activityRowToRecord(row);
    });
  }

  async history(
    userId: string,
    query: ActivityHistoryQuery = {},
  ): Promise<ActivityRecordRow[]> {
    return runDb(async () => {
      const rows = await this.prisma.activityRecord.findMany({
        where: {
          userId,
          ...(query.kind ? { kind: query.kind } : {}),
          ...(query.from || query.to
            ? {
                date: {
                  ...(query.from ? { gte: parseDay(query.from, "from") } : {}),
                  ...(query.to ? { lte: parseDay(query.to, "to") } : {}),
                },
              }
            : {}),
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: boundedLimit(query.limit, 100),
      });
      return rows.map(activityRowToRecord);
    });
  }
}
