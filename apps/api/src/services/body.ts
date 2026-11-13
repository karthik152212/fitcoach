import type {
  ActivityRecordRow,
  ActivityRepository,
  BodyMeasurementRecord,
  BodyMeasurementRepository,
  MeasurementHistoryQuery,
  ActivityHistoryQuery,
  RecordActivityInput,
  RecordMeasurementInput,
  RecordStepsInput,
  UserRepository,
  SleepRepository,
  RecoveryRepository,
  SleepObservationRecord,
  RecoveryIndicatorRecord,
  RecordSleepInput,
  RecordRecoveryIndicatorInput,
  SleepHistoryQuery,
  RecoveryHistoryQuery,
} from "@fitcoach/db";
import type { ActivityKind, CalendarDate, Timestamp } from "@fitcoach/domain";
import { toUserLocalDate } from "@fitcoach/domain";
import { ConstraintValidationError, NotFoundError } from "@fitcoach/db";

/**
 * Body measurement + activity services.
 *
 * Every daily default (the day a steps record belongs to) is derived from the
 * user's IANA timezone — never from UTC (milestone §3).
 */

export interface RecordMeasurementCommand {
  id?: string;
  recordedAt?: Timestamp;
  condition?: RecordMeasurementInput["condition"];
  bodyWeightKg?: number;
  bodyFatPercent?: number;
  circumferencesCm?: Record<string, number>;
  enteredVia?: RecordMeasurementInput["enteredVia"];
  confidence?: RecordMeasurementInput["confidence"];
  sourceName?: string;
  externalId?: string;
  photoRefs?: string[];
  notes?: string;
}

export interface RecordActivityCommand {
  id?: string;
  date?: CalendarDate;
  kind: ActivityKind;
  steps?: number;
  durationMinutes?: number;
  distanceKm?: number;
  averageHeartRateBpm?: number;
  estimatedCaloriesBurned?: number;
  effort?: "low" | "moderate" | "high";
  recordedVia?: string;
  externalId?: string;
  notes?: string;
}

export class BodyMeasurementService {
  constructor(
    private readonly measurements: BodyMeasurementRepository,
    private readonly users: UserRepository,
  ) {}

  private async requireUser(userId: string): Promise<{ timezone: string }> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError(`user ${userId} not found`);
    return user;
  }

  async record(
    userId: string,
    command: RecordMeasurementCommand,
  ): Promise<BodyMeasurementRecord> {
    await this.requireUser(userId);
    const input: RecordMeasurementInput = {
      ...(command.id ? { id: command.id } : {}),
      userId,
      ...(command.recordedAt ? { recordedAt: command.recordedAt } : {}),
      ...(command.condition ? { condition: command.condition } : {}),
      ...(command.bodyWeightKg !== undefined ? { bodyWeightKg: command.bodyWeightKg } : {}),
      ...(command.bodyFatPercent !== undefined ? { bodyFatPercent: command.bodyFatPercent } : {}),
      ...(command.circumferencesCm
        ? { circumferencesCm: command.circumferencesCm as RecordMeasurementInput["circumferencesCm"] }
        : {}),
      ...(command.enteredVia ? { enteredVia: command.enteredVia } : {}),
      ...(command.confidence ? { confidence: command.confidence } : {}),
      ...(command.sourceName ? { sourceName: command.sourceName } : {}),
      ...(command.externalId ? { externalId: command.externalId } : {}),
      ...(command.photoRefs ? { photoRefs: command.photoRefs } : {}),
      ...(command.notes ? { notes: command.notes } : {}),
    };
    return this.measurements.record(input);
  }

  async history(userId: string, query: MeasurementHistoryQuery): Promise<BodyMeasurementRecord[]> {
    await this.requireUser(userId);
    return this.measurements.history(userId, query);
  }
}

export class ActivityService {
  constructor(
    private readonly activity: ActivityRepository,
    private readonly users: UserRepository,
  ) {}

  private async resolveDate(userId: string, date?: CalendarDate): Promise<CalendarDate> {
    if (date) return date;
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError(`user ${userId} not found`);
    return toUserLocalDate(new Date(), user.timezone);
  }

  async record(userId: string, command: RecordActivityCommand): Promise<ActivityRecordRow> {
    const date = await this.resolveDate(userId, command.date);

    if (command.kind === "steps") {
      if (command.steps === undefined) {
        throw new ConstraintValidationError("kind 'steps' requires a steps value");
      }
      const input: RecordStepsInput = {
        ...(command.id ? { id: command.id } : {}),
        userId,
        date,
        steps: command.steps,
        ...(command.recordedVia ? { recordedVia: command.recordedVia } : {}),
        ...(command.externalId ? { externalId: command.externalId } : {}),
        ...(command.notes ? { notes: command.notes } : {}),
      };
      return this.activity.recordSteps(input);
    }

    const input: RecordActivityInput = {
      ...(command.id ? { id: command.id } : {}),
      userId,
      date,
      kind: command.kind as Exclude<ActivityKind, "steps">,
      ...(command.durationMinutes !== undefined ? { durationMinutes: command.durationMinutes } : {}),
      ...(command.distanceKm !== undefined ? { distanceKm: command.distanceKm } : {}),
      ...(command.averageHeartRateBpm !== undefined
        ? { averageHeartRateBpm: command.averageHeartRateBpm }
        : {}),
      ...(command.estimatedCaloriesBurned !== undefined
        ? { estimatedCaloriesBurned: command.estimatedCaloriesBurned }
        : {}),
      ...(command.effort ? { effort: command.effort } : {}),
      ...(command.recordedVia ? { recordedVia: command.recordedVia } : {}),
      ...(command.externalId ? { externalId: command.externalId } : {}),
      ...(command.notes ? { notes: command.notes } : {}),
    };
    return this.activity.record(input);
  }

  async history(userId: string, query: ActivityHistoryQuery): Promise<ActivityRecordRow[]> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError(`user ${userId} not found`);
    return this.activity.history(userId, query);
  }
}

export interface RecordSleepCommand {
  id?: string;
  date?: CalendarDate;
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

export interface RecordRecoveryIndicatorCommand {
  id?: string;
  date?: CalendarDate;
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

export class SleepService {
  constructor(
    private readonly sleep: SleepRepository,
    private readonly users: UserRepository,
  ) {}

  private async requireUser(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError(`user ${userId} not found`);
  }

  async record(userId: string, command: RecordSleepCommand): Promise<SleepObservationRecord> {
    await this.requireUser(userId);
    const date = command.date ?? toUserLocalDate(new Date(), (await this.users.findById(userId))!.timezone);
    const input: RecordSleepInput = {
      ...(command.id ? { id: command.id } : {}),
      userId,
      date,
      startedAt: command.startedAt,
      endedAt: command.endedAt,
      ...(command.timeInBedMinutes !== undefined ? { timeInBedMinutes: command.timeInBedMinutes } : {}),
      ...(command.asleepMinutes !== undefined ? { asleepMinutes: command.asleepMinutes } : {}),
      ...(command.efficiency !== undefined ? { efficiency: command.efficiency } : {}),
      ...(command.latencyMinutes !== undefined ? { latencyMinutes: command.latencyMinutes } : {}),
      ...(command.deepMinutes !== undefined ? { deepMinutes: command.deepMinutes } : {}),
      ...(command.remMinutes !== undefined ? { remMinutes: command.remMinutes } : {}),
      ...(command.lightMinutes !== undefined ? { lightMinutes: command.lightMinutes } : {}),
      ...(command.awakeMinutes !== undefined ? { awakeMinutes: command.awakeMinutes } : {}),
      ...(command.awakenings !== undefined ? { awakenings: command.awakenings } : {}),
      source: command.source,
      ...(command.externalId ? { externalId: command.externalId } : {}),
      confidence: command.confidence,
      ...(command.notes ? { notes: command.notes } : {}),
    };
    return this.sleep.record(input);
  }

  async history(userId: string, query: SleepHistoryQuery = {}): Promise<SleepObservationRecord[]> {
    await this.requireUser(userId);
    return this.sleep.history(userId, query);
  }
}

export class RecoveryService {
  constructor(
    private readonly recovery: RecoveryRepository,
    private readonly users: UserRepository,
  ) {}

  private async requireUser(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError(`user ${userId} not found`);
  }

  async record(userId: string, command: RecordRecoveryIndicatorCommand): Promise<RecoveryIndicatorRecord> {
    await this.requireUser(userId);
    const date = command.date ?? toUserLocalDate(new Date(), (await this.users.findById(userId))!.timezone);
    const input: RecordRecoveryIndicatorInput = {
      ...(command.id ? { id: command.id } : {}),
      userId,
      date,
      ...(command.hrvMs !== undefined ? { hrvMs: command.hrvMs } : {}),
      ...(command.restingHeartRateBpm !== undefined ? { restingHeartRateBpm: command.restingHeartRateBpm } : {}),
      ...(command.sleepScore !== undefined ? { sleepScore: command.sleepScore } : {}),
      ...(command.readinessScore !== undefined ? { readinessScore: command.readinessScore } : {}),
      ...(command.muscleSoreness !== undefined ? { muscleSoreness: command.muscleSoreness } : {}),
      ...(command.fatigue !== undefined ? { fatigue: command.fatigue } : {}),
      ...(command.sleepQuality !== undefined ? { sleepQuality: command.sleepQuality } : {}),
      ...(command.readinessSubjective !== undefined ? { readinessSubjective: command.readinessSubjective } : {}),
      source: command.source,
      ...(command.externalId ? { externalId: command.externalId } : {}),
      confidence: command.confidence,
      ...(command.notes ? { notes: command.notes } : {}),
    };
    return this.recovery.record(input);
  }

  async history(userId: string, query: RecoveryHistoryQuery = {}): Promise<RecoveryIndicatorRecord[]> {
    await this.requireUser(userId);
    return this.recovery.history(userId, query);
  }
}
