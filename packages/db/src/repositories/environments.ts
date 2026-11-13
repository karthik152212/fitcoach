import type { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type {
  CalendarDate,
  TrainingEnvironmentKind,
  TrainingEnvironmentPeriod,
} from "@fitcoach/domain";
import { ConstraintValidationError, NotFoundError } from "../errors";
import { newUuidv7 } from "../ids";
import { toCalendarDate, toTimestamp } from "../mapping";
import { runDb } from "./util";

/**
 * Training environments (Phase 3.1).
 *
 * Interval-versioned exactly like `user_equipment` and exercise preferences:
 * recording a new environment closes the open row and opens a new one. A user
 * who says "I'm at home with no equipment for a week" therefore cannot rewrite
 * what last month's gym sessions meant, and "what could they do on that day?"
 * stays answerable. The GOAL is never touched by these rows.
 */

const ENVIRONMENT_KINDS: readonly TrainingEnvironmentKind[] = [
  "gym",
  "home",
  "home_no_equipment",
  "home_limited_equipment",
  "hotel",
  "travel",
  "outdoor",
  "custom",
];

export interface CreateEnvironmentPeriodInput {
  id?: string;
  userId: string;
  kind: TrainingEnvironmentKind;
  availableEquipmentIds?: readonly string[];
  unavailableEquipmentIds?: readonly string[];
  /** User-local day the environment starts (inclusive). */
  effectiveFrom: CalendarDate;
  /** User-local day it ends (exclusive). Absent = open-ended. */
  effectiveTo?: CalendarDate;
  reason?: string;
  isTemporary?: boolean;
  notes?: string;
}

export interface TrainingEnvironmentRepository {
  /** Opens an environment period, closing any earlier open one. */
  createPeriod(input: CreateEnvironmentPeriodInput): Promise<TrainingEnvironmentPeriod>;
  /** All periods, newest first. */
  listPeriods(userId: string): Promise<TrainingEnvironmentPeriod[]>;
  /** The period in force on `asOf`, or null when the default applies. */
  findActive(userId: string, asOf: CalendarDate): Promise<TrainingEnvironmentPeriod | null>;
  /** Closes a period at `effectiveTo` (the only permitted update). */
  closePeriod(periodId: string, effectiveTo: CalendarDate): Promise<TrainingEnvironmentPeriod>;
  /** Closes the open period, if any, restoring the default environment. */
  closeOpenPeriod(userId: string, effectiveTo: CalendarDate): Promise<TrainingEnvironmentPeriod | null>;
}

function parseDate(value: CalendarDate, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ConstraintValidationError(`${field} must be YYYY-MM-DD`);
  }
  return new Date(`${value}T00:00:00.000Z`);
}

interface EnvironmentRow {
  id: string;
  userId: string;
  kind: string;
  config: Prisma.JsonValue;
  validFrom: Date;
  validTo: Date | null;
  createdAt: Date;
}

function rowToRecord(row: EnvironmentRow): TrainingEnvironmentPeriod {
  const config = (row.config ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind as TrainingEnvironmentKind,
    availableEquipmentIds: ((config.availableEquipmentIds as string[]) ?? []).sort(),
    unavailableEquipmentIds: ((config.unavailableEquipmentIds as string[]) ?? []).sort(),
    effectiveFrom: toCalendarDate(row.validFrom),
    ...(row.validTo ? { effectiveTo: toCalendarDate(row.validTo) } : {}),
    ...(config.reason ? { reason: config.reason as string } : {}),
    isTemporary: (config.isTemporary as boolean) ?? true,
    ...(config.notes ? { notes: config.notes as string } : {}),
    createdAt: toTimestamp(row.createdAt),
  };
}

export class PrismaTrainingEnvironmentRepository implements TrainingEnvironmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createPeriod(input: CreateEnvironmentPeriodInput): Promise<TrainingEnvironmentPeriod> {
    if (!ENVIRONMENT_KINDS.includes(input.kind)) {
      throw new ConstraintValidationError(`unknown training environment kind ${input.kind}`);
    }
    const validFrom = parseDate(input.effectiveFrom, "effectiveFrom");
    const validTo = input.effectiveTo
      ? parseDate(input.effectiveTo, "effectiveTo")
      : null;
    if (validTo && validTo.getTime() <= validFrom.getTime()) {
      throw new ConstraintValidationError("effectiveTo must be after effectiveFrom");
    }

    return runDb(async () =>
      this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } });
        if (!user) throw new NotFoundError(`user ${input.userId} not found`);

        // Close the open row instead of editing it: the interval is the history.
        const open = await tx.trainingEnvironmentPeriod.findFirst({
          where: { userId: input.userId, validTo: null },
          orderBy: { validFrom: "desc" },
        });
        if (open && open.validFrom.getTime() >= validFrom.getTime()) {
          throw new ConstraintValidationError(
            "a new environment must start after the currently open environment's start",
          );
        }
        if (open) {
          await tx.trainingEnvironmentPeriod.updateMany({
            where: { id: open.id, validTo: null },
            data: { validTo: validFrom },
          });
        }

        const config = {
          availableEquipmentIds: [...new Set(input.availableEquipmentIds ?? [])].sort(),
          unavailableEquipmentIds: [...new Set(input.unavailableEquipmentIds ?? [])].sort(),
          reason: input.reason ?? null,
          isTemporary: input.isTemporary ?? true,
          notes: input.notes ?? null,
        };

        const row = await tx.trainingEnvironmentPeriod.create({
          data: {
            id: input.id ?? newUuidv7(),
            userId: input.userId,
            kind: input.kind,
            config: config as Prisma.InputJsonValue,
            validFrom,
            validTo,
          },
        });
        return rowToRecord(row);
      }),
    );
  }

  async listPeriods(userId: string): Promise<TrainingEnvironmentPeriod[]> {
    return runDb(async () => {
      const rows = await this.prisma.trainingEnvironmentPeriod.findMany({
        where: { userId },
        orderBy: [{ validFrom: "desc" }, { id: "asc" }],
      });
      return rows.map(rowToRecord);
    });
  }

  async findActive(
    userId: string,
    asOf: CalendarDate,
  ): Promise<TrainingEnvironmentPeriod | null> {
    return runDb(async () => {
      const at = parseDate(asOf, "asOf");
      const row = await this.prisma.trainingEnvironmentPeriod.findFirst({
        where: {
          userId,
          validFrom: { lte: at },
          OR: [{ validTo: null }, { validTo: { gt: at } }],
        },
        orderBy: [{ validFrom: "desc" }, { id: "asc" }],
      });
      return row ? rowToRecord(row) : null;
    });
  }

  async closePeriod(periodId: string, effectiveTo: CalendarDate): Promise<TrainingEnvironmentPeriod> {
    const end = parseDate(effectiveTo, "effectiveTo");
    return runDb(async () =>
      this.prisma.$transaction(async (tx) => {
        const existing = await tx.trainingEnvironmentPeriod.findUnique({ where: { id: periodId } });
        if (!existing) throw new NotFoundError(`training environment period ${periodId} not found`);
        if (end.getTime() <= existing.validFrom.getTime()) {
          throw new ConstraintValidationError("effectiveTo must be after effectiveFrom");
        }
        const row = await tx.trainingEnvironmentPeriod.update({
          where: { id: periodId },
          data: { validTo: end },
        });
        return rowToRecord(row);
      }),
    );
  }

  async closeOpenPeriod(
    userId: string,
    effectiveTo: CalendarDate,
  ): Promise<TrainingEnvironmentPeriod | null> {
    const end = parseDate(effectiveTo, "effectiveTo");
    return runDb(async () =>
      this.prisma.$transaction(async (tx) => {
        const open = await tx.trainingEnvironmentPeriod.findFirst({
          where: { userId, validTo: null },
          orderBy: { validFrom: "desc" },
        });
        if (!open) return null;
        if (end.getTime() <= open.validFrom.getTime()) {
          // A same-or-earlier end is a no-op window rather than a zero-length
          // interval; leaving the row open is the honest outcome.
          return rowToRecord(open);
        }
        const row = await tx.trainingEnvironmentPeriod.update({
          where: { id: open.id },
          data: { validTo: end },
        });
        return rowToRecord(row);
      }),
    );
  }
}
