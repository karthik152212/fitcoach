import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type {
  ActivityKind,
  BodySite,
  CalendarDate,
  EffortLevel,
  MeasurementCondition,
  Timestamp,
  UserId,
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

export interface BodyMeasurementStateSnapshot {
  latestWeightKg?: number;
  latestBodyFatPercent?: number;
  weightTrend7d?: number;
  weightTrend28d?: number;
  measurementsCount: number;
  windowDays: number;
}

export interface BodyMeasurementRepository {
  /** Append-only. Idempotent on (userId, enteredVia, externalId). */
  record(input: RecordMeasurementInput): Promise<BodyMeasurementRecord>;
  history(userId: string, query?: MeasurementHistoryQuery): Promise<BodyMeasurementRecord[]>;
  /** Get a state snapshot for unified decision brain (recent window aggregate). */
  getStateSnapshot(userId: string, asOf: CalendarDate, windowDays?: number): Promise<BodyMeasurementStateSnapshot | null>;
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

  async getStateSnapshot(
    userId: string,
    asOf: CalendarDate,
    windowDays: number = 28,
  ): Promise<BodyMeasurementStateSnapshot | null> {
    const endDate = new Date(`${asOf}T23:59:59.999Z`);
    const startDate = new Date(endDate.getTime() - windowDays * 86400000);

    return runDb(async () => {
      const rows = await this.prisma.bodyMeasurement.findMany({
        where: {
          userId,
          recordedAt: { gte: startDate, lte: endDate },
        },
        include: MEASUREMENT_INCLUDE,
        orderBy: { recordedAt: "asc" },
      });

      if (rows.length === 0) return null;

      const records = rows.map(measurementRowToRecord);

      // Latest measurements
      const latest = records[records.length - 1];
      const latestWeightKg = latest?.bodyWeightKg;
      const latestBodyFatPercent = latest?.bodyFatPercent;

      // Weight trends
      const weightRecords = records.filter((r) => r.bodyWeightKg !== undefined);
      let weightTrend7d: number | undefined;
      let weightTrend28d: number | undefined;

      if (weightRecords.length >= 2) {
        const last = weightRecords[weightRecords.length - 1];
        if (!last) return { latestWeightKg, latestBodyFatPercent, weightTrend7d, weightTrend28d, measurementsCount: records.length, windowDays };
        const now = last.bodyWeightKg ?? 0;
        const weekAgo = weightRecords.find((r) => {
          const date = new Date(r.recordedAt);
          return date.getTime() <= endDate.getTime() - 7 * 86400000;
        });
        const monthAgo = weightRecords[0];

        if (weekAgo) weightTrend7d = now - (weekAgo.bodyWeightKg ?? 0);
        if (monthAgo) weightTrend28d = now - (monthAgo.bodyWeightKg ?? 0);
      }

      return {
        latestWeightKg,
        latestBodyFatPercent,
        weightTrend7d,
        weightTrend28d,
        measurementsCount: records.length,
        windowDays,
      };
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
  updatedAt: string;
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
    updatedAt: toTimestamp(row.createdAt),
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

export interface ActivityStateSnapshot {
  averageDailySteps: number;
  stepsTrend7d: number;
  stepsTrend28d: number;
  sessionsPerWeek: number;
  totalActiveMinutesWeekly: number;
  windowDays: number;
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
  /** Get a state snapshot for unified decision brain (recent window aggregate). */
  getStateSnapshot(userId: string, asOf: CalendarDate, windowDays?: number): Promise<ActivityStateSnapshot | null>;
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
    updatedAt: toTimestamp(row.created_at),
  };
}

function parseDay(value: CalendarDate, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ConstraintValidationError(`${field} must be YYYY-MM-DD`);
  }
  return new Date(`${value}T00:00:00.000Z`);
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

  async getStateSnapshot(
    userId: string,
    asOf: CalendarDate,
    windowDays: number = 28,
  ): Promise<ActivityStateSnapshot | null> {
    const endDate = parseDay(asOf, "asOf");
    const startDate = new Date(endDate.getTime() - windowDays * 86400000);

    return runDb(async () => {
      const rows = await this.prisma.activityRecord.findMany({
        where: {
          userId,
          date: { gte: startDate, lte: endDate },
        },
        orderBy: { date: "asc" },
      });

      if (rows.length === 0) return null;

      const records = rows.map(activityRowToRecord);

      // Steps records only
      const stepsRecords = records.filter((r) => r.kind === "steps" && r.steps !== undefined);
      const sessionRecords = records.filter((r) => r.kind !== "steps" && r.durationMinutes !== undefined);

      const averageDailySteps = stepsRecords.length > 0
        ? stepsRecords.reduce((sum, r) => sum + (r.steps ?? 0), 0) / stepsRecords.length
        : 0;

      // Steps trends
      let stepsTrend7d = 0;
      let stepsTrend28d = 0;
      if (stepsRecords.length >= 2) {
        const recent = stepsRecords.slice(-7);
        const older = stepsRecords.slice(0, Math.max(0, stepsRecords.length - 7));
        if (recent.length > 0 && older.length > 0) {
          const recentAvg = recent.reduce((sum, r) => sum + (r.steps ?? 0), 0) / recent.length;
          const olderAvg = older.reduce((sum, r) => sum + (r.steps ?? 0), 0) / older.length;
          stepsTrend7d = recentAvg - olderAvg;
        }
        const first = stepsRecords[0];
        const last = stepsRecords[stepsRecords.length - 1];
        if (first?.steps !== undefined && last?.steps !== undefined) {
          stepsTrend28d = (last.steps ?? 0) - (first.steps ?? 0);
        }
      }

      // Sessions per week
      const totalSessions = sessionRecords.length;
      const weeks = windowDays / 7;
      const sessionsPerWeek = weeks > 0 ? totalSessions / weeks : 0;

      // Total active minutes weekly
      const totalActiveMinutes = sessionRecords.reduce((sum, r) => sum + (r.durationMinutes ?? 0), 0);
      const totalActiveMinutesWeekly = weeks > 0 ? totalActiveMinutes / weeks : 0;

      return {
        averageDailySteps,
        stepsTrend7d,
        stepsTrend28d,
        sessionsPerWeek,
        totalActiveMinutesWeekly,
        windowDays,
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Sleep observations (append-only, §4.10)
// ---------------------------------------------------------------------------

interface SleepObservationRow {
  id: string;
  userId: string;
  date: Date;
  startedAt: Date;
  endedAt: Date;
  timeInBedMinutes: number | null;
  asleepMinutes: number | null;
  efficiency: number | null;
  latencyMinutes: number | null;
  deepMinutes: number | null;
  remMinutes: number | null;
  lightMinutes: number | null;
  awakeMinutes: number | null;
  awakenings: number | null;
  source: string;
  externalId: string | null;
  confidence: string;
  notes: string | null;
  createdAt: Date;
}

export interface SleepObservationRecord {
  id: string;
  userId: string;
  date: CalendarDate;
  startedAt: Timestamp;
  endedAt: Timestamp;
  timeInBedMinutes?: number;
  asleepMinutes?: number;
  efficiency?: number;
  latencyMinutes?: number;
  deepMinutes?: number;
  remMinutes?: number;
  lightMinutes?: number;
  awakeMinutes?: number;
  awakenings?: number;
  source: string;
  externalId?: string;
  confidence: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecordSleepInput {
  id?: string;
  userId: string;
  date: CalendarDate;
  startedAt: Timestamp;
  endedAt: Timestamp;
  timeInBedMinutes?: number;
  asleepMinutes?: number;
  efficiency?: number;
  latencyMinutes?: number;
  deepMinutes?: number;
  remMinutes?: number;
  lightMinutes?: number;
  awakeMinutes?: number;
  awakenings?: number;
  source: string;
  externalId?: string;
  confidence: string;
  notes?: string;
}

export interface SleepHistoryQuery {
  limit?: number;
  from?: CalendarDate;
  to?: CalendarDate;
  source?: string;
}

export interface SleepStateSnapshot {
  averageSleepMinutes: number;
  averageEfficiency: number;
  averageLatencyMinutes: number;
  sleepDebtMinutes: number;
  consistencyScore: number;
  windowDays: number;
}

export interface SleepRepository {
  /** Append-only. Idempotent on (userId, date, source, externalId). */
  record(input: RecordSleepInput): Promise<SleepObservationRecord>;
  history(userId: string, query?: SleepHistoryQuery): Promise<SleepObservationRecord[]>;
  /** Get a state snapshot for unified decision brain (recent window aggregate). */
  getStateSnapshot(userId: string, asOf: CalendarDate, windowDays?: number): Promise<SleepStateSnapshot | null>;
}

function sleepRowToRecord(row: SleepObservationRow): SleepObservationRecord {
  return {
    id: row.id,
    userId: row.userId,
    date: toCalendarDate(row.date),
    startedAt: toTimestamp(row.startedAt),
    endedAt: toTimestamp(row.endedAt),
    timeInBedMinutes: row.timeInBedMinutes ?? undefined,
    asleepMinutes: row.asleepMinutes ?? undefined,
    efficiency: row.efficiency ?? undefined,
    latencyMinutes: row.latencyMinutes ?? undefined,
    deepMinutes: row.deepMinutes ?? undefined,
    remMinutes: row.remMinutes ?? undefined,
    lightMinutes: row.lightMinutes ?? undefined,
    awakeMinutes: row.awakeMinutes ?? undefined,
    awakenings: row.awakenings ?? undefined,
    source: row.source,
    externalId: row.externalId ?? undefined,
    confidence: row.confidence,
    notes: row.notes ?? undefined,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.createdAt),
  };
}

export class PrismaSleepRepository implements SleepRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(input: RecordSleepInput): Promise<SleepObservationRecord> {
    const date = parseDay(input.date, "date");
    const id = input.id ?? newUuidv7();
    return runDb(async () => {
      if (input.externalId) {
        const existing = await this.prisma.sleepObservation.findFirst({
          where: { userId: input.userId, date, source: input.source, externalId: input.externalId },
        });
        if (existing) return sleepRowToRecord(existing);
      }
      const row = await this.prisma.sleepObservation.create({
        data: {
          id,
          userId: input.userId,
          date,
          startedAt: new Date(input.startedAt),
          endedAt: new Date(input.endedAt),
          timeInBedMinutes: input.timeInBedMinutes ?? null,
          asleepMinutes: input.asleepMinutes ?? null,
          efficiency: input.efficiency ?? null,
          latencyMinutes: input.latencyMinutes ?? null,
          deepMinutes: input.deepMinutes ?? null,
          remMinutes: input.remMinutes ?? null,
          lightMinutes: input.lightMinutes ?? null,
          awakeMinutes: input.awakeMinutes ?? null,
          awakenings: input.awakenings ?? null,
          source: input.source,
          externalId: input.externalId ?? null,
          confidence: input.confidence,
          notes: input.notes ?? null,
        },
      });
      return sleepRowToRecord(row);
    });
  }

  async history(
    userId: string,
    query: SleepHistoryQuery = {},
  ): Promise<SleepObservationRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.sleepObservation.findMany({
        where: {
          userId,
          ...(query.source ? { source: query.source } : {}),
          ...(query.from || query.to
            ? {
                date: {
                  ...(query.from ? { gte: parseDay(query.from, "from") } : {}),
                  ...(query.to ? { lte: parseDay(query.to, "to") } : {}),
                },
              }
            : {}),
        },
        orderBy: { date: "desc" },
        take: boundedLimit(query.limit, 100),
      });
      return rows.map(sleepRowToRecord);
    });
  }

  async getStateSnapshot(
    userId: string,
    asOf: CalendarDate,
    windowDays: number = 14,
  ): Promise<SleepStateSnapshot | null> {
    const endDate = parseDay(asOf, "asOf");
    const startDate = new Date(endDate.getTime() - windowDays * 86400000);

    return runDb(async () => {
      const rows = await this.prisma.sleepObservation.findMany({
        where: {
          userId,
          date: { gte: startDate, lte: endDate },
        },
        orderBy: { date: "asc" },
      });

      if (rows.length === 0) return null;

      const records = rows.map(sleepRowToRecord);

      const averageSleepMinutes = records.reduce((sum, r) => sum + (r.asleepMinutes ?? 0), 0) / records.length;
      const averageEfficiency = records.filter((r) => r.efficiency !== undefined).reduce((sum, r) => sum + (r.efficiency ?? 0), 0) / records.filter((r) => r.efficiency !== undefined).length || 0;
      const averageLatencyMinutes = records.filter((r) => r.latencyMinutes !== undefined).reduce((sum, r) => sum + (r.latencyMinutes ?? 0), 0) / records.filter((r) => r.latencyMinutes !== undefined).length || 0;

      // Sleep debt: assuming 8 hours (480 min) target
      const targetMinutes = 480;
      const sleepDebtMinutes = Math.max(0, records.length * targetMinutes - records.reduce((sum, r) => sum + (r.asleepMinutes ?? 0), 0));

      // Consistency score: inverse of standard deviation of sleep duration
      const durations = records.map((r) => r.asleepMinutes ?? 0);
      const meanDuration = averageSleepMinutes;
      const variance = durations.reduce((sum, d) => sum + Math.pow(d - meanDuration, 2), 0) / durations.length;
      const stdDev = Math.sqrt(variance);
      const consistencyScore = Math.max(0, 100 - (stdDev / 60) * 100); // 1 hour std dev = ~16 points penalty

      return {
        averageSleepMinutes,
        averageEfficiency,
        averageLatencyMinutes,
        sleepDebtMinutes,
        consistencyScore,
        windowDays,
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Recovery indicators (append-only, §4.11)
// ---------------------------------------------------------------------------

interface RecoveryIndicatorRow {
  id: string;
  userId: string;
  date: Date;
  hrvMs: unknown;
  restingHeartRateBpm: number | null;
  sleepScore: number | null;
  readinessScore: number | null;
  muscleSoreness: number | null;
  fatigue: number | null;
  sleepQuality: number | null;
  readinessSubjective: number | null;
  source: string;
  externalId: string | null;
  confidence: string;
  notes: string | null;
  createdAt: Date;
}

export interface RecoveryIndicatorRecord {
  id: string;
  userId: string;
  date: CalendarDate;
  hrvMs?: number;
  restingHeartRateBpm?: number;
  sleepScore?: number;
  readinessScore?: number;
  muscleSoreness?: number;
  fatigue?: number;
  sleepQuality?: number;
  readinessSubjective?: number;
  source: string;
  externalId?: string;
  confidence: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecordRecoveryIndicatorInput {
  id?: string;
  userId: string;
  date: CalendarDate;
  hrvMs?: number;
  restingHeartRateBpm?: number;
  sleepScore?: number;
  readinessScore?: number;
  muscleSoreness?: number;
  fatigue?: number;
  sleepQuality?: number;
  readinessSubjective?: number;
  source: string;
  externalId?: string;
  confidence: string;
  notes?: string;
}

export interface RecoveryHistoryQuery {
  limit?: number;
  from?: CalendarDate;
  to?: CalendarDate;
  source?: string;
}

export interface RecoveryStateSnapshot {
  averageReadinessScore: number;
  averageHrvMs: number;
  averageRestingHeartRateBpm: number;
  averageSleepScore: number;
  averageMuscleSoreness: number;
  averageFatigue: number;
  lowReadinessDays: number;
  windowDays: number;
}

export interface RecoveryRepository {
  /** Append-only. Idempotent on (userId, date, source, externalId). */
  record(input: RecordRecoveryIndicatorInput): Promise<RecoveryIndicatorRecord>;
  history(userId: string, query?: RecoveryHistoryQuery): Promise<RecoveryIndicatorRecord[]>;
  /** Get a state snapshot for unified decision brain (recent window aggregate). */
  getStateSnapshot(userId: string, asOf: CalendarDate, windowDays?: number): Promise<RecoveryStateSnapshot | null>;
}

function recoveryRowToRecord(row: RecoveryIndicatorRow): RecoveryIndicatorRecord {
  return {
    id: row.id,
    userId: row.userId,
    date: toCalendarDate(row.date),
    hrvMs: decimalToNumber(row.hrvMs),
    restingHeartRateBpm: row.restingHeartRateBpm ?? undefined,
    sleepScore: row.sleepScore ?? undefined,
    readinessScore: row.readinessScore ?? undefined,
    muscleSoreness: row.muscleSoreness ?? undefined,
    fatigue: row.fatigue ?? undefined,
    sleepQuality: row.sleepQuality ?? undefined,
    readinessSubjective: row.readinessSubjective ?? undefined,
    source: row.source,
    externalId: row.externalId ?? undefined,
    confidence: row.confidence,
    notes: row.notes ?? undefined,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.createdAt),
  };
}

export class PrismaRecoveryRepository implements RecoveryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(input: RecordRecoveryIndicatorInput): Promise<RecoveryIndicatorRecord> {
    const date = parseDay(input.date, "date");
    const id = input.id ?? newUuidv7();
    return runDb(async () => {
      if (input.externalId) {
        const existing = await this.prisma.recoveryIndicator.findFirst({
          where: { userId: input.userId, date, source: input.source, externalId: input.externalId },
        });
        if (existing) return recoveryRowToRecord(existing);
      }
      const row = await this.prisma.recoveryIndicator.create({
        data: {
          id,
          userId: input.userId,
          date,
          hrvMs: input.hrvMs ?? null,
          restingHeartRateBpm: input.restingHeartRateBpm ?? null,
          sleepScore: input.sleepScore ?? null,
          readinessScore: input.readinessScore ?? null,
          muscleSoreness: input.muscleSoreness ?? null,
          fatigue: input.fatigue ?? null,
          sleepQuality: input.sleepQuality ?? null,
          readinessSubjective: input.readinessSubjective ?? null,
          source: input.source,
          externalId: input.externalId ?? null,
          confidence: input.confidence,
          notes: input.notes ?? null,
        },
      });
      return recoveryRowToRecord(row);
    });
  }

  async history(
    userId: string,
    query: RecoveryHistoryQuery = {},
  ): Promise<RecoveryIndicatorRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.recoveryIndicator.findMany({
        where: {
          userId,
          ...(query.source ? { source: query.source } : {}),
          ...(query.from || query.to
            ? {
                date: {
                  ...(query.from ? { gte: parseDay(query.from, "from") } : {}),
                  ...(query.to ? { lte: parseDay(query.to, "to") } : {}),
                },
              }
            : {}),
        },
        orderBy: { date: "desc" },
        take: boundedLimit(query.limit, 100),
      });
      return rows.map(recoveryRowToRecord);
    });
  }

  async getStateSnapshot(
    userId: string,
    asOf: CalendarDate,
    windowDays: number = 14,
  ): Promise<RecoveryStateSnapshot | null> {
    const endDate = parseDay(asOf, "asOf");
    const startDate = new Date(endDate.getTime() - windowDays * 86400000);

    return runDb(async () => {
      const rows = await this.prisma.recoveryIndicator.findMany({
        where: {
          userId,
          date: { gte: startDate, lte: endDate },
        },
        orderBy: { date: "asc" },
      });

      if (rows.length === 0) return null;

      const records = rows.map(recoveryRowToRecord);

      const averageReadinessScore = records.reduce((sum, r) => sum + (r.readinessScore ?? 0), 0) / records.length;
      const averageHrvMs = records.filter((r) => r.hrvMs !== undefined).reduce((sum, r) => sum + (r.hrvMs ?? 0), 0) / records.filter((r) => r.hrvMs !== undefined).length || 0;
      const averageRestingHeartRateBpm = records.filter((r) => r.restingHeartRateBpm !== undefined).reduce((sum, r) => sum + (r.restingHeartRateBpm ?? 0), 0) / records.filter((r) => r.restingHeartRateBpm !== undefined).length || 0;
      const averageSleepScore = records.filter((r) => r.sleepScore !== undefined).reduce((sum, r) => sum + (r.sleepScore ?? 0), 0) / records.filter((r) => r.sleepScore !== undefined).length || 0;
      const averageMuscleSoreness = records.filter((r) => r.muscleSoreness !== undefined).reduce((sum, r) => sum + (r.muscleSoreness ?? 0), 0) / records.filter((r) => r.muscleSoreness !== undefined).length || 0;
      const averageFatigue = records.filter((r) => r.fatigue !== undefined).reduce((sum, r) => sum + (r.fatigue ?? 0), 0) / records.filter((r) => r.fatigue !== undefined).length || 0;

      const lowReadinessDays = records.filter((r) => (r.readinessScore ?? 100) < 50).length;

      return {
        averageReadinessScore,
        averageHrvMs,
        averageRestingHeartRateBpm,
        averageSleepScore,
        averageMuscleSoreness,
        averageFatigue,
        lowReadinessDays,
        windowDays,
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Physique Goals (interval-versioned, one active per user)
// ---------------------------------------------------------------------------

interface PhysiqueGoalRow {
  id: string;
  userId: string;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  customPriorities: unknown;
  targetTimeframeWeeks: number | null;
  direction: string;
  createdAt: Date;
  updatedAt: Date;
  priorities: { id: string; position: number; tag: string }[];
}

export interface PhysiqueGoalRecord {
  id: string;
  userId: UserId;
  priorities: readonly { tag: string; label: string }[];
  customPriorities?: readonly { tag: string; label: string }[];
  targetTimeframeWeeks?: number;
  direction: "maintain" | "gain" | "lose" | "recomp";
  effectiveFrom: CalendarDate;
  effectiveUntil?: CalendarDate;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CreatePhysiqueGoalInput {
  userId: UserId;
  priorities: readonly { tag: string; label: string }[];
  customPriorities?: readonly { tag: string; label: string }[];
  targetTimeframeWeeks?: number;
  direction?: "maintain" | "gain" | "lose" | "recomp";
  effectiveFrom?: CalendarDate;
}

export interface UpdatePhysiqueGoalInput {
  priorities?: readonly { tag: string; label: string }[];
  customPriorities?: readonly { tag: string; label: string }[];
  targetTimeframeWeeks?: number | null;
  direction?: "maintain" | "gain" | "lose" | "recomp";
}

export interface PhysiqueGoalRepository {
  /** Create a new active physique goal (closes any existing active goal). */
  create(input: CreatePhysiqueGoalInput): Promise<PhysiqueGoalRecord>;
  /** Get the currently active physique goal for a user. */
  getActive(userId: UserId): Promise<PhysiqueGoalRecord | null>;
  /** Get physique goal history for a user. */
  history(userId: UserId, limit?: number): Promise<PhysiqueGoalRecord[]>;
  /** Update the active physique goal. */
  update(userId: UserId, input: UpdatePhysiqueGoalInput): Promise<PhysiqueGoalRecord>;
  /** Delete the active physique goal. */
  delete(userId: UserId): Promise<void>;
}

function physiqueGoalRowToRecord(row: PhysiqueGoalRow): PhysiqueGoalRecord {
  const priorities = row.priorities
    .sort((a, b) => a.position - b.position)
    .map((p) => ({ tag: p.tag, label: p.tag }));

  return {
    id: row.id,
    userId: row.userId as UserId,
    priorities,
    customPriorities: (row.customPriorities as PhysiqueGoalRecord["customPriorities"]) ?? undefined,
    targetTimeframeWeeks: row.targetTimeframeWeeks ?? undefined,
    direction: row.direction as PhysiqueGoalRecord["direction"],
    effectiveFrom: toCalendarDate(row.effectiveFrom),
    effectiveUntil: row.effectiveUntil ? toCalendarDate(row.effectiveUntil) : undefined,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

export class PrismaPhysiqueGoalRepository implements PhysiqueGoalRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreatePhysiqueGoalInput): Promise<PhysiqueGoalRecord> {
    const id = newUuidv7();
    const effectiveFrom = input.effectiveFrom ? new Date(`${input.effectiveFrom}T00:00:00.000Z`) : new Date();

    return runDb(async () => {
      // Close any existing active goal
      await this.prisma.physiqueGoal.updateMany({
        where: { userId: input.userId, effectiveUntil: null },
        data: { effectiveUntil: new Date(effectiveFrom.getTime() - 86400000) }, // Day before new goal
      });

      const row = await this.prisma.physiqueGoal.create({
        data: {
          id,
          userId: input.userId,
          effectiveFrom,
          customPriorities: input.customPriorities ?? Prisma.DbNull,
          targetTimeframeWeeks: input.targetTimeframeWeeks ?? null,
          direction: input.direction ?? "recomp",
          priorities: {
            create: input.priorities.map((p, index) => ({
              id: newUuidv7(),
              position: index,
              tag: p.tag,
            })),
          },
        },
        include: { priorities: true },
      });

      return physiqueGoalRowToRecord(row);
    });
  }

  async getActive(userId: UserId): Promise<PhysiqueGoalRecord | null> {
    return runDb(async () => {
      const row = await this.prisma.physiqueGoal.findFirst({
        where: { userId, effectiveUntil: null },
        include: { priorities: true },
        orderBy: { effectiveFrom: "desc" },
      });
      return row ? physiqueGoalRowToRecord(row) : null;
    });
  }

  async history(userId: UserId, limit = 50): Promise<PhysiqueGoalRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.physiqueGoal.findMany({
        where: { userId },
        include: { priorities: true },
        orderBy: { effectiveFrom: "desc" },
        take: boundedLimit(limit, 100),
      });
      return rows.map(physiqueGoalRowToRecord);
    });
  }

  async update(userId: UserId, input: UpdatePhysiqueGoalInput): Promise<PhysiqueGoalRecord> {
    return runDb(async () => {
      const active = await this.prisma.physiqueGoal.findFirst({
        where: { userId, effectiveUntil: null },
        include: { priorities: true },
      });
      if (!active) throw new NotFoundError("no active physique goal");

      // If priorities are changing, we need to create a new interval version
      const hasPriorityChanges =
        input.priorities !== undefined &&
        (input.priorities.length !== active.priorities.length ||
          input.priorities.some((p, i) => p.tag !== active.priorities[i]?.tag));

      if (hasPriorityChanges) {
        // Close current goal and create new one
        const effectiveFrom = new Date();
        await this.prisma.physiqueGoal.update({
          where: { id: active.id },
          data: { effectiveUntil: new Date(effectiveFrom.getTime() - 86400000) },
        });

        const newId = newUuidv7();
        const row = await this.prisma.physiqueGoal.create({
          data: {
            id: newId,
            userId,
            effectiveFrom,
            customPriorities: input.customPriorities ?? active.customPriorities ?? Prisma.DbNull,
            targetTimeframeWeeks: input.targetTimeframeWeeks ?? active.targetTimeframeWeeks,
            direction: input.direction ?? active.direction,
            priorities: {
              create: (input.priorities ?? active.priorities.map((p) => ({ tag: p.tag, label: p.tag }))).map(
                (p, index) => ({ id: newUuidv7(), position: index, tag: p.tag }),
              ),
            },
          },
          include: { priorities: true },
        });
        return physiqueGoalRowToRecord(row);
      }

      // Simple field updates
      const row = await this.prisma.physiqueGoal.update({
        where: { id: active.id },
        data: {
          ...(input.customPriorities !== undefined
            ? { customPriorities: input.customPriorities ?? Prisma.DbNull }
            : {}),
          ...(input.targetTimeframeWeeks !== undefined ? { targetTimeframeWeeks: input.targetTimeframeWeeks } : {}),
          ...(input.direction !== undefined ? { direction: input.direction } : {}),
        },
        include: { priorities: true },
      });
      return physiqueGoalRowToRecord(row);
    });
  }

  async delete(userId: UserId): Promise<void> {
    return runDb(async () => {
      const active = await this.prisma.physiqueGoal.findFirst({
        where: { userId, effectiveUntil: null },
      });
      if (active) {
        await this.prisma.physiqueGoal.update({
          where: { id: active.id },
          data: { effectiveUntil: new Date() },
        });
      }
    });
  }
}
