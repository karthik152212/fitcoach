import type { PrismaClient } from "@prisma/client";
import type {
  ExerciseCategory,
  MuscleGroup,
  MuscleRole,
  MovementPattern,
} from "@fitcoach/domain";
import { NotFoundError } from "../errors";
import { newUuidv7 } from "../ids";
import { decimalToNumber, toTimestamp } from "../mapping";
import { runDb } from "./util";

interface MuscleRow {
  id: string;
  externalSourceId: string | null;
  slug: string;
  name: string;
  group: string;
  displayName: string | null;
  externalId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MuscleRecord {
  id: string;
  slug: string;
  name: string;
  group: MuscleGroup;
  displayName?: string;
  externalSourceId?: string;
  externalId?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExerciseMuscleRelationRecord {
  exerciseId: string;
  muscleId: string;
  role: MuscleRole;
  contributionWeight?: number;
}

interface ExerciseRow {
  id: string;
  externalSourceId: string | null;
  slug: string;
  name: string;
  aliases: string[];
  category: string;
  movementPattern: string | null;
  unilateral: boolean;
  instructions: string | null;
  externalId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface RequiredEquipmentRow {
  exerciseId: string;
  equipmentId: string;
}

interface MuscleRelationRow {
  exerciseId: string;
  muscleId: string;
  role: string;
  contributionWeight: unknown;
}

export interface ExerciseRecord {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  category: ExerciseCategory;
  movementPattern?: MovementPattern;
  unilateral: boolean;
  instructions?: string;
  externalSourceId?: string;
  externalId?: string;
  isActive: boolean;
  /** All listed pieces are required simultaneously. */
  requiredEquipmentIds: string[];
  muscleRelations: ExerciseMuscleRelationRecord[];
  createdAt: string;
  updatedAt: string;
}

function muscleRowToRecord(row: MuscleRow): MuscleRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    group: row.group as MuscleGroup,
    displayName: row.displayName ?? undefined,
    externalSourceId: row.externalSourceId ?? undefined,
    externalId: row.externalId ?? undefined,
    isActive: row.isActive,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

interface ExerciseChildren {
  requiredEquipment: RequiredEquipmentRow[];
  muscleRelations: MuscleRelationRow[];
}

function exerciseRowToRecord(row: ExerciseRow & Partial<ExerciseChildren>): ExerciseRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    aliases: row.aliases ?? [],
    category: row.category as ExerciseCategory,
    movementPattern: (row.movementPattern ?? undefined) as MovementPattern | undefined,
    unilateral: row.unilateral,
    instructions: row.instructions ?? undefined,
    externalSourceId: row.externalSourceId ?? undefined,
    externalId: row.externalId ?? undefined,
    isActive: row.isActive,
    requiredEquipmentIds: (row.requiredEquipment ?? []).map((item) => item.equipmentId),
    muscleRelations: (row.muscleRelations ?? []).map((relation) => ({
      exerciseId: relation.exerciseId,
      muscleId: relation.muscleId,
      role: relation.role as MuscleRole,
      contributionWeight: decimalToNumber(relation.contributionWeight),
    })),
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

const EXERCISE_INCLUDE = {
  requiredEquipment: true,
  muscleRelations: true,
} as const;

export interface UpsertMuscleInput {
  id?: string;
  slug: string;
  name: string;
  group: MuscleGroup;
  displayName?: string;
  externalSourceId?: string;
  externalId?: string;
}

export interface MuscleRelationInput {
  muscleId: string;
  role: MuscleRole;
  contributionWeight?: number;
}

export interface UpsertExerciseInput {
  id?: string;
  slug: string;
  name: string;
  aliases?: readonly string[];
  category: ExerciseCategory;
  movementPattern?: MovementPattern;
  unilateral?: boolean;
  instructions?: string;
  externalSourceId?: string;
  externalId?: string;
  requiredEquipmentIds?: readonly string[];
  muscleRelations?: readonly MuscleRelationInput[];
}

export interface ExerciseRepository {
  /** Idempotent upsert by slug — used by the development seed. */
  upsertMuscle(input: UpsertMuscleInput): Promise<MuscleRecord>;
  upsertExercise(input: UpsertExerciseInput): Promise<ExerciseRecord>;
  findExerciseById(id: string): Promise<ExerciseRecord | null>;
  findExercisesByIds(ids: readonly string[]): Promise<ExerciseRecord[]>;
  listExercises(options?: { includeInactive?: boolean }): Promise<ExerciseRecord[]>;
  listMuscles(options?: { includeInactive?: boolean }): Promise<MuscleRecord[]>;
}

export class PrismaExerciseRepository implements ExerciseRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertMuscle(input: UpsertMuscleInput): Promise<MuscleRecord> {
    return runDb(async () => {
      const row = await this.prisma.muscle.upsert({
        where: { slug: input.slug },
        create: {
          id: input.id ?? newUuidv7(),
          slug: input.slug,
          name: input.name,
          group: input.group,
          displayName: input.displayName ?? null,
          externalSourceId: input.externalSourceId ?? null,
          externalId: input.externalId ?? null,
        },
        update: {
          name: input.name,
          group: input.group,
          displayName: input.displayName ?? null,
        },
      });
      return muscleRowToRecord(row);
    });
  }

  async upsertExercise(input: UpsertExerciseInput): Promise<ExerciseRecord> {
    return runDb(async () => {
      return this.prisma.$transaction(async (tx) => {
        const id = input.id ?? newUuidv7();
        const base = {
          name: input.name,
          aliases: [...(input.aliases ?? [])],
          category: input.category,
          movementPattern: input.movementPattern ?? null,
          unilateral: input.unilateral ?? false,
          instructions: input.instructions ?? null,
          externalSourceId: input.externalSourceId ?? null,
          externalId: input.externalId ?? null,
        };

        const row = await tx.exercise.upsert({
          where: { slug: input.slug },
          create: { id, slug: input.slug, ...base },
          update: base,
          include: EXERCISE_INCLUDE,
        });

        // Relations are replaced wholesale: catalog re-syncs are declarative.
        if (input.requiredEquipmentIds) {
          await tx.exerciseRequiredEquipment.deleteMany({ where: { exerciseId: row.id } });
          await tx.exerciseRequiredEquipment.createMany({
            data: [...new Set(input.requiredEquipmentIds)].map((equipmentId) => ({
              exerciseId: row.id,
              equipmentId,
            })),
          });
        }
        if (input.muscleRelations) {
          await tx.exerciseMuscleRelation.deleteMany({ where: { exerciseId: row.id } });
          if (input.muscleRelations.length > 0) {
            await tx.exerciseMuscleRelation.createMany({
              data: input.muscleRelations.map((relation) => ({
                exerciseId: row.id,
                muscleId: relation.muscleId,
                role: relation.role,
                contributionWeight: relation.contributionWeight ?? null,
              })),
            });
          }
        }

        const full = await tx.exercise.findUnique({
          where: { id: row.id },
          include: EXERCISE_INCLUDE,
        });
        if (!full) throw new NotFoundError("exercise disappeared after upsert");
        return exerciseRowToRecord(full);
      });
    });
  }

  async findExerciseById(id: string): Promise<ExerciseRecord | null> {
    return runDb(async () => {
      const row = await this.prisma.exercise.findUnique({
        where: { id },
        include: EXERCISE_INCLUDE,
      });
      return row ? exerciseRowToRecord(row) : null;
    });
  }

  async findExercisesByIds(ids: readonly string[]): Promise<ExerciseRecord[]> {
    if (ids.length === 0) return [];
    return runDb(async () => {
      const rows = await this.prisma.exercise.findMany({
        where: { id: { in: [...ids] } },
        include: EXERCISE_INCLUDE,
      });
      return rows.map((row) => exerciseRowToRecord(row));
    });
  }

  async listExercises(options?: { includeInactive?: boolean }): Promise<ExerciseRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.exercise.findMany({
        where: options?.includeInactive ? undefined : { isActive: true },
        include: EXERCISE_INCLUDE,
        orderBy: { slug: "asc" },
      });
      return rows.map((row) => exerciseRowToRecord(row));
    });
  }

  async listMuscles(options?: { includeInactive?: boolean }): Promise<MuscleRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.muscle.findMany({
        where: options?.includeInactive ? undefined : { isActive: true },
        orderBy: { slug: "asc" },
      });
      return rows.map(muscleRowToRecord);
    });
  }
}
