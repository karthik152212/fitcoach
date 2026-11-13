import type { PrismaClient } from "@prisma/client";
import type { ExercisePreferenceKind } from "@fitcoach/domain";
import { NotFoundError } from "../errors";
import { newUuidv7 } from "../ids";
import { toTimestamp } from "../mapping";
import { runDb } from "./util";

/**
 * User exercise preferences (Phase 2, §17/§37).
 *
 * Simple non-versioned preferences stored as current state. The schema
 * stores one row per (user, exercise) with the current preference.
 */

export interface UserExercisePreferenceRecord {
  id: string;
  userId: string;
  exerciseId: string;
  exerciseName?: string;
  preference: ExercisePreferenceKind;
  notes?: string;
  recordedAt: string;
}

export interface SetExercisePreferenceInput {
  userId: string;
  exerciseId: string;
  preference: ExercisePreferenceKind;
  notes?: string;
}

export interface ExercisePreferenceRepository {
  setPreference(input: SetExercisePreferenceInput): Promise<UserExercisePreferenceRecord>;
  listPreferences(userId: string): Promise<UserExercisePreferenceRecord[]>;
}

function rowToRecord(row: {
  id: string;
  userId: string;
  exerciseId: string;
  preference: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  exercise?: { name: string };
}): UserExercisePreferenceRecord {
  return {
    id: row.id,
    userId: row.userId,
    exerciseId: row.exerciseId,
    exerciseName: row.exercise?.name,
    preference: row.preference as ExercisePreferenceKind,
    notes: row.notes ?? undefined,
    recordedAt: toTimestamp(row.createdAt),
  };
}

const PREFERENCE_INCLUDE = { exercise: { select: { name: true } } } as const;

export class PrismaExercisePreferenceRepository implements ExercisePreferenceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async setPreference(input: SetExercisePreferenceInput): Promise<UserExercisePreferenceRecord> {
    return runDb(async () =>
      this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } });
        if (!user) throw new NotFoundError(`user ${input.userId} not found`);
        const exercise = await tx.exercise.findUnique({
          where: { id: input.exerciseId },
          select: { id: true },
        });
        if (!exercise) throw new NotFoundError(`exercise ${input.exerciseId} not found`);

        const row = await tx.userExercisePreference.upsert({
          where: { userId_exerciseId: { userId: input.userId, exerciseId: input.exerciseId } },
          create: {
            id: newUuidv7(),
            userId: input.userId,
            exerciseId: input.exerciseId,
            preference: input.preference,
            notes: input.notes ?? null,
          },
          update: {
            preference: input.preference,
            notes: input.notes ?? null,
          },
          include: PREFERENCE_INCLUDE,
        });
        return rowToRecord(row);
      }),
    );
  }

  async listPreferences(userId: string): Promise<UserExercisePreferenceRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.userExercisePreference.findMany({
        where: { userId },
        include: PREFERENCE_INCLUDE,
        orderBy: [{ createdAt: "desc" }],
      });
      return rows.map(rowToRecord);
    });
  }
}
