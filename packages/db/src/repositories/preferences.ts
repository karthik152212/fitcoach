import type { PrismaClient } from "@prisma/client";
import type { CalendarDate, ExercisePreferenceKind } from "@fitcoach/domain";
import { ConstraintValidationError, NotFoundError } from "../errors";
import { newUuidv7 } from "../ids";
import { toCalendarDate, toTimestamp } from "../mapping";
import { runDb } from "./util";

/**
 * User exercise preferences (Phase 2, §17/§37).
 *
 * Preferences are interval-versioned exactly like `user_equipment`: recording a
 * new preference closes the currently open row and opens a new one. A user who
 * says "I hate barbell squats" today therefore cannot change what last month's
 * workout meant, and a workout written while an exercise was `excluded` still
 * shows that the exclusion was in force at the time.
 *
 * Preferences never hard-exclude an exercise from the catalog: they are an
 * input to suitability scoring, and `excluded` removes it from *selection*
 * while keeping it resolvable for history and explanation.
 */

export interface UserExercisePreferenceRecord {
  id: string;
  userId: string;
  exerciseId: string;
  exerciseName?: string;
  preference: ExercisePreferenceKind;
  reason?: string;
  validFrom: CalendarDate;
  validTo?: CalendarDate;
  /** When the preference was recorded (logging time, distinct from validFrom). */
  recordedAt: string;
}

export interface SetExercisePreferenceInput {
  userId: string;
  exerciseId: string;
  preference: ExercisePreferenceKind;
  /** User-local day the preference starts applying (inclusive). */
  validFrom: CalendarDate;
  reason?: string;
}

export interface ExercisePreferenceRepository {
  setPreference(input: SetExercisePreferenceInput): Promise<UserExercisePreferenceRecord>;
  /** With `at`, answers "what did the user think on that day?" */
  listPreferences(userId: string, at?: CalendarDate): Promise<UserExercisePreferenceRecord[]>;
  /** Open (currently applicable) preferences for several exercises at once. */
  listCurrentPreferences(
    userId: string,
    at?: CalendarDate,
  ): Promise<UserExercisePreferenceRecord[]>;
}

function parseDate(value: CalendarDate, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ConstraintValidationError(`${field} must be YYYY-MM-DD`);
  }
  return new Date(`${value}T00:00:00.000Z`);
}

function rowToRecord(row: {
  id: string;
  userId: string;
  exerciseId: string;
  preference: string;
  reason: string | null;
  validFrom: Date;
  validTo: Date | null;
  recordedAt: Date;
  exercise?: { name: string };
}): UserExercisePreferenceRecord {
  return {
    id: row.id,
    userId: row.userId,
    exerciseId: row.exerciseId,
    exerciseName: row.exercise?.name,
    preference: row.preference as ExercisePreferenceKind,
    reason: row.reason ?? undefined,
    validFrom: toCalendarDate(row.validFrom),
    validTo: row.validTo ? toCalendarDate(row.validTo) : undefined,
    recordedAt: toTimestamp(row.recordedAt),
  };
}

const PREFERENCE_INCLUDE = { exercise: { select: { name: true } } } as const;

export class PrismaExercisePreferenceRepository implements ExercisePreferenceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async setPreference(input: SetExercisePreferenceInput): Promise<UserExercisePreferenceRecord> {
    const validFrom = parseDate(input.validFrom, "validFrom");
    return runDb(async () =>
      this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } });
        if (!user) throw new NotFoundError(`user ${input.userId} not found`);
        const exercise = await tx.exercise.findUnique({
          where: { id: input.exerciseId },
          select: { id: true },
        });
        if (!exercise) throw new NotFoundError(`exercise ${input.exerciseId} not found`);

        // Close the currently open row rather than editing it: the interval is
        // the history. valid_to is exclusive, so a same-day re-record is a
        // no-op window rather than a zero-length one.
        const open = await tx.userExercisePreference.findFirst({
          where: { userId: input.userId, exerciseId: input.exerciseId, validTo: null },
        });
        if (open && open.validFrom.getTime() >= validFrom.getTime()) {
          throw new ConstraintValidationError(
            "a new preference must start after the currently open preference's start",
          );
        }
        if (open) {
          await tx.userExercisePreference.updateMany({
            where: { id: open.id, validTo: null },
            data: { validTo: validFrom },
          });
        }

        const row = await tx.userExercisePreference.create({
          data: {
            id: newUuidv7(),
            userId: input.userId,
            exerciseId: input.exerciseId,
            preference: input.preference,
            reason: input.reason ?? null,
            validFrom,
            validTo: null,
          },
          include: PREFERENCE_INCLUDE,
        });
        return rowToRecord(row);
      }),
    );
  }

  async listPreferences(
    userId: string,
    at?: CalendarDate,
  ): Promise<UserExercisePreferenceRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.userExercisePreference.findMany({
        where: {
          userId,
          ...(at
            ? {
                validFrom: { lte: parseDate(at, "at") },
                OR: [{ validTo: null }, { validTo: { gt: parseDate(at, "at") } }],
              }
            : {}),
        },
        include: PREFERENCE_INCLUDE,
        orderBy: [{ validFrom: "desc" }],
      });
      return rows.map(rowToRecord);
    });
  }

  async listCurrentPreferences(
    userId: string,
    at?: CalendarDate,
  ): Promise<UserExercisePreferenceRecord[]> {
    return this.listPreferences(userId, at);
  }
}
