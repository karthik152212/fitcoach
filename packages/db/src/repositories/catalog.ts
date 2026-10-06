import type { PrismaClient } from "@prisma/client";
import type {
  ExerciseCategory,
  ExerciseRole,
  LoadingCharacteristic,
  MovementFunction,
  MovementPattern,
  MuscleEmphasis,
  MuscleGroup,
  MuscleRole,
  MuscleStructureKind,
  RangeOfMotionCharacteristic,
  StabilityDemand,
} from "@fitcoach/domain";
import { NotFoundError } from "../errors";
import { newUuidv7 } from "../ids";
import { decimalToNumber, toTimestamp } from "../mapping";
import { runDb } from "./util";

/**
 * Exercise / muscle catalog (Phase 1 + Phase 2).
 *
 * Two read shapes exist on purpose:
 *
 *   * `ExerciseRecord` — the lean definition used by write paths (workout
 *     logging, plan slots). It must stay cheap to load.
 *   * `ExerciseKnowledgeRecord` — the full Phase 2 intelligence bundle
 *     (targeting resolved against muscles and structures, movement functions,
 *     roles). Only the exercise-intelligence paths load it.
 *
 * Targeting is persisted in two relations and read back as ONE resolved
 * `ExerciseMuscleTarget` list, because the engines and the visual layer must
 * never have to know whether a row came from the whole-muscle table or the
 * structure table.
 */

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

export interface MuscleStructureRecord {
  id: string;
  muscleId: string;
  slug: string;
  name: string;
  kind: MuscleStructureKind;
  displayName?: string;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A muscle plus the heads/regions/portions coverage analysis can address. */
export interface MuscleWithStructures {
  muscle: MuscleRecord;
  structures: MuscleStructureRecord[];
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
  emphasis?: MuscleEmphasis;
  confidence?: number;
  notes?: string;
  externalSourceId?: string;
}

/** One resolved targeting entry: whole-muscle or narrowed to a structure. */
export interface ExerciseTargetRecord {
  muscleId: string;
  muscleSlug: string;
  muscleDisplayName: string;
  muscleGroup: MuscleGroup;
  role: MuscleRole;
  structureId?: string;
  structureSlug?: string;
  structureDisplayName?: string;
  structureKind?: MuscleStructureKind;
  emphasis?: MuscleEmphasis;
  contributionWeight?: number;
  confidence?: number;
  notes?: string;
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
  variationKey: string | null;
  variationLabel: string | null;
  stabilityDemand: string | null;
  loadingCharacteristic: string | null;
  rangeOfMotionCharacteristic: string | null;
  knowledgeVersion: number;
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
  emphasis: string | null;
  confidence: unknown;
  notes: string | null;
  externalSourceId: string | null;
}

interface StructureRelationRow extends MuscleRelationRow {
  structureId: string;
}

interface MovementFunctionRow {
  exerciseId: string;
  functionId: string;
  isPrimary: boolean;
  function: { id: string; slug: string; name: string; region: string };
}

interface RoleRow {
  exerciseId: string;
  role: string;
  position: number;
}

interface ExerciseChildren {
  requiredEquipment: RequiredEquipmentRow[];
  muscleRelations: MuscleRelationRow[];
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
  /** Phase 2: stable identity of this exercise variation, if catalogued. */
  variationKey?: string;
  variationLabel?: string;
  knowledgeVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** The full Phase 2 intelligence bundle for one exercise variation. */
export interface ExerciseKnowledgeRecord extends ExerciseRecord {
  stabilityDemand?: StabilityDemand;
  loadingCharacteristic?: LoadingCharacteristic;
  rangeOfMotionCharacteristic?: RangeOfMotionCharacteristic;
  /** Resolved targeting, whole-muscle and structure-level, sorted stably. */
  targets: ExerciseTargetRecord[];
  movementFunctions: MovementFunction[];
  primaryMovementFunction?: MovementFunction;
  roles: ExerciseRole[];
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
      emphasis: (relation.emphasis ?? undefined) as MuscleEmphasis | undefined,
      confidence: decimalToNumber(relation.confidence),
      notes: relation.notes ?? undefined,
      externalSourceId: relation.externalSourceId ?? undefined,
    })),
    variationKey: row.variationKey ?? undefined,
    variationLabel: row.variationLabel ?? undefined,
    knowledgeVersion: row.knowledgeVersion,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

const EXERCISE_INCLUDE = {
  requiredEquipment: true,
  muscleRelations: true,
} as const;

const KNOWLEDGE_INCLUDE = {
  requiredEquipment: true,
  muscleRelations: { include: { muscle: true } },
  structureRelations: { include: { muscle: true, structure: true } },
  movementFunctions: { include: { function: true } },
  roles: true,
} as const;

/** Deterministic ordering for the resolved target list. */
function compareTargets(a: ExerciseTargetRecord, b: ExerciseTargetRecord): number {
  const roleOrder: Record<MuscleRole, number> = {
    primary_mover: 0,
    secondary_mover: 1,
    supporting: 2,
    stabilizer: 3,
  };
  if (roleOrder[a.role] !== roleOrder[b.role]) return roleOrder[a.role] - roleOrder[b.role];
  if (a.muscleSlug !== b.muscleSlug) return a.muscleSlug < b.muscleSlug ? -1 : 1;
  const aStructure = a.structureSlug ?? "";
  const bStructure = b.structureSlug ?? "";
  if (aStructure !== bStructure) return aStructure < bStructure ? -1 : 1;
  return 0;
}

type KnowledgeRow = ExerciseRow & {
  stabilityDemand: string | null;
  loadingCharacteristic: string | null;
  rangeOfMotionCharacteristic: string | null;
  muscleRelations: Array<MuscleRelationRow & { muscle: MuscleRow }>;
  structureRelations: Array<
    StructureRelationRow & { muscle: MuscleRow; structure: { id: string; slug: string; name: string; displayName: string | null; kind: string } }
  >;
  movementFunctions: MovementFunctionRow[];
  roles: RoleRow[];
};

/**
 * Flatten both targeting relations into one resolved list. Whole-muscle rows
 * come first; structure rows follow and always carry their parent muscle, so a
 * structure contribution can never be read as a standalone muscle.
 */
export function resolveExerciseTargets(row: KnowledgeRow): ExerciseTargetRecord[] {
  const targets: ExerciseTargetRecord[] = [];

  for (const relation of row.muscleRelations) {
    targets.push({
      muscleId: relation.muscleId,
      muscleSlug: relation.muscle.slug,
      muscleDisplayName: relation.muscle.displayName ?? relation.muscle.name,
      muscleGroup: relation.muscle.group as MuscleGroup,
      role: relation.role as MuscleRole,
      ...(decimalToNumber(relation.contributionWeight) !== undefined
        ? { contributionWeight: decimalToNumber(relation.contributionWeight) }
        : {}),
      ...(decimalToNumber(relation.confidence) !== undefined
        ? { confidence: decimalToNumber(relation.confidence) }
        : {}),
      ...(relation.emphasis ? { emphasis: relation.emphasis as MuscleEmphasis } : {}),
      ...(relation.notes ? { notes: relation.notes } : {}),
    });
  }

  for (const relation of row.structureRelations) {
    targets.push({
      muscleId: relation.muscleId,
      muscleSlug: relation.muscle.slug,
      muscleDisplayName: relation.muscle.displayName ?? relation.muscle.name,
      muscleGroup: relation.muscle.group as MuscleGroup,
      role: relation.role as MuscleRole,
      structureId: relation.structureId,
      structureSlug: relation.structure.slug,
      structureDisplayName: relation.structure.displayName ?? relation.structure.name,
      structureKind: relation.structure.kind as MuscleStructureKind,
      ...(decimalToNumber(relation.contributionWeight) !== undefined
        ? { contributionWeight: decimalToNumber(relation.contributionWeight) }
        : {}),
      ...(decimalToNumber(relation.confidence) !== undefined
        ? { confidence: decimalToNumber(relation.confidence) }
        : {}),
      ...(relation.emphasis ? { emphasis: relation.emphasis as MuscleEmphasis } : {}),
      ...(relation.notes ? { notes: relation.notes } : {}),
    });
  }

  return targets.sort(compareTargets);
}

export function exerciseKnowledgeRowToRecord(row: KnowledgeRow): ExerciseKnowledgeRecord {
  const base = exerciseRowToRecord(row);
  const functions = [...row.movementFunctions]
    .sort((a, b) => a.function.slug.localeCompare(b.function.slug))
    .map((item) => item.function.slug as MovementFunction);
  const primary = row.movementFunctions.find((item) => item.isPrimary);
  return {
    ...base,
    stabilityDemand: (row.stabilityDemand ?? undefined) as StabilityDemand | undefined,
    loadingCharacteristic: (row.loadingCharacteristic ?? undefined) as
      | LoadingCharacteristic
      | undefined,
    rangeOfMotionCharacteristic: (row.rangeOfMotionCharacteristic ?? undefined) as
      | RangeOfMotionCharacteristic
      | undefined,
    targets: resolveExerciseTargets(row),
    movementFunctions: functions,
    primaryMovementFunction: (primary?.function.slug ?? undefined) as MovementFunction | undefined,
    roles: [...row.roles]
      .sort((a, b) => a.position - b.position)
      .map((item) => item.role as ExerciseRole),
  };
}

export interface UpsertMuscleInput {
  id?: string;
  slug: string;
  name: string;
  group: MuscleGroup;
  displayName?: string;
  externalSourceId?: string;
  externalId?: string;
}

/** A head/region/portion belonging to one muscle. */
export interface UpsertMuscleStructureInput {
  id?: string;
  muscleSlug: string;
  slug: string;
  name: string;
  kind: MuscleStructureKind;
  displayName?: string;
  notes?: string;
}

export interface MuscleRelationInput {
  muscleSlug: string;
  role: MuscleRole;
  contributionWeight?: number;
  emphasis?: MuscleEmphasis;
  confidence?: number;
  notes?: string;
  externalSourceId?: string;
}

/** A head/region-level contribution; `structureSlug` is unique per muscle. */
export interface StructureRelationInput extends Omit<MuscleRelationInput, "muscleSlug"> {
  muscleSlug: string;
  structureSlug: string;
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
  requiredEquipment?: readonly string[];
  /** Whole-muscle targeting; replaces the whole set on upsert. */
  relations?: readonly MuscleRelationInput[];
  /** Head/region targeting; replaces the whole set on upsert. */
  structureRelations?: readonly StructureRelationInput[];
  /** Movement-function slugs; replaces the whole set on upsert. */
  movementFunctions?: readonly MovementFunction[];
  /** The function that best characterises the exercise (must be in the set). */
  primaryMovementFunction?: MovementFunction;
  /** Program roles, in author order. */
  roles?: readonly ExerciseRole[];
  variationKey?: string;
  variationLabel?: string;
  stabilityDemand?: StabilityDemand;
  loadingCharacteristic?: LoadingCharacteristic;
  rangeOfMotionCharacteristic?: RangeOfMotionCharacteristic;
  knowledgeVersion?: number;
}

export interface UpsertMovementFunctionInput {
  slug: string;
  name: string;
  region: string;
  description?: string;
}

export interface SearchExercisesQuery {
  /** Case-insensitive substring match over name and aliases. */
  q?: string;
  muscleSlug?: string;
  structureSlug?: string;
  category?: ExerciseCategory;
  movementPattern?: MovementPattern;
  movementFunction?: MovementFunction;
  role?: ExerciseRole;
  equipmentIds?: readonly string[];
  includeInactive?: boolean;
}

export interface ExerciseRepository {
  /** Idempotent upsert by slug — used by the development seed. */
  upsertMuscle(input: UpsertMuscleInput): Promise<MuscleRecord>;
  upsertMuscleStructure(input: UpsertMuscleStructureInput): Promise<MuscleStructureRecord>;
  upsertMovementFunction(input: UpsertMovementFunctionInput): Promise<{ id: string; slug: string }>;
  upsertExercise(input: UpsertExerciseInput): Promise<ExerciseRecord>;
  findExerciseById(id: string): Promise<ExerciseRecord | null>;
  findExercisesByIds(ids: readonly string[]): Promise<ExerciseRecord[]>;
  listExercises(options?: { includeInactive?: boolean }): Promise<ExerciseRecord[]>;
  listMuscles(options?: { includeInactive?: boolean }): Promise<MuscleRecord[]>;
  /** Muscles with their structures — the taxonomy read model. */
  listMuscleTaxonomy(options?: { includeInactive?: boolean }): Promise<MuscleWithStructures[]>;
  findMuscleStructure(id: string): Promise<MuscleStructureRecord | null>;
  /** Full Phase 2 intelligence bundle for one exercise. */
  findExerciseKnowledge(idOrSlug: string): Promise<ExerciseKnowledgeRecord | null>;
  listExerciseKnowledge(query?: SearchExercisesQuery): Promise<ExerciseKnowledgeRecord[]>;
  listMovementFunctions(): Promise<UpsertMovementFunctionInput[]>;
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

  async upsertMuscleStructure(
    input: UpsertMuscleStructureInput,
  ): Promise<MuscleStructureRecord> {
    return runDb(async () => {
      const muscle = await this.prisma.muscle.findUnique({
        where: { slug: input.muscleSlug },
        select: { id: true },
      });
      if (!muscle) throw new NotFoundError(`muscle ${input.muscleSlug} not found`);
      const row = await this.prisma.muscleStructure.upsert({
        where: { muscleId_slug: { muscleId: muscle.id, slug: input.slug } },
        create: {
          id: input.id ?? newUuidv7(),
          muscleId: muscle.id,
          slug: input.slug,
          name: input.name,
          kind: input.kind,
          displayName: input.displayName ?? null,
          notes: input.notes ?? null,
        },
        update: {
          name: input.name,
          kind: input.kind,
          displayName: input.displayName ?? null,
          notes: input.notes ?? null,
        },
      });
      return {
        id: row.id,
        muscleId: row.muscleId,
        slug: row.slug,
        name: row.name,
        kind: row.kind as MuscleStructureKind,
        displayName: row.displayName ?? undefined,
        notes: row.notes ?? undefined,
        isActive: row.isActive,
        createdAt: toTimestamp(row.createdAt),
        updatedAt: toTimestamp(row.updatedAt),
      };
    });
  }

  async upsertMovementFunction(
    input: UpsertMovementFunctionInput,
  ): Promise<{ id: string; slug: string }> {
    return runDb(async () => {
      const row = await this.prisma.movementFunction.upsert({
        where: { slug: input.slug },
        create: {
          id: newUuidv7(),
          slug: input.slug,
          name: input.name,
          region: input.region,
          description: input.description ?? null,
        },
        update: { name: input.name, region: input.region, description: input.description ?? null },
      });
      return { id: row.id, slug: row.slug };
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
          variationKey: input.variationKey ?? null,
          variationLabel: input.variationLabel ?? null,
          stabilityDemand: input.stabilityDemand ?? null,
          loadingCharacteristic: input.loadingCharacteristic ?? null,
          rangeOfMotionCharacteristic: input.rangeOfMotionCharacteristic ?? null,
          knowledgeVersion: input.knowledgeVersion ?? 1,
        };

        const row = await tx.exercise.upsert({
          where: { slug: input.slug },
          create: { id, slug: input.slug, ...base },
          update: base,
          include: EXERCISE_INCLUDE,
        });

        // Relations are replaced wholesale: catalog re-syncs are declarative.
        if (input.requiredEquipment) {
          await tx.exerciseRequiredEquipment.deleteMany({ where: { exerciseId: row.id } });
          const equipmentIds: string[] = [];
          for (const slug of new Set(input.requiredEquipment)) {
            const equipment = await tx.equipment.findUnique({ where: { slug }, select: { id: true } });
            if (!equipment) throw new NotFoundError(`equipment ${slug} not found`);
            equipmentIds.push(equipment.id);
          }
          if (equipmentIds.length > 0) {
            await tx.exerciseRequiredEquipment.createMany({
              data: equipmentIds.map((equipmentId) => ({ exerciseId: row.id, equipmentId })),
            });
          }
        }

        if (input.relations) {
          await tx.exerciseMuscleRelation.deleteMany({ where: { exerciseId: row.id } });
          const data: {
            exerciseId: string;
            muscleId: string;
            role: string;
            contributionWeight: number | null;
            emphasis: string | null;
            confidence: number | null;
            notes: string | null;
            externalSourceId: string | null;
          }[] = [];
          for (const relation of input.relations) {
            const muscle = await tx.muscle.findUnique({
              where: { slug: relation.muscleSlug },
              select: { id: true },
            });
            if (!muscle) throw new NotFoundError(`muscle ${relation.muscleSlug} not found`);
            data.push({
              exerciseId: row.id,
              muscleId: muscle.id,
              role: relation.role,
              contributionWeight: relation.contributionWeight ?? null,
              emphasis: relation.emphasis ?? null,
              confidence: relation.confidence ?? null,
              notes: relation.notes ?? null,
              externalSourceId: relation.externalSourceId ?? null,
            });
          }
          if (data.length > 0) await tx.exerciseMuscleRelation.createMany({ data });
        }

        if (input.structureRelations) {
          await tx.exerciseMuscleStructureRelation.deleteMany({ where: { exerciseId: row.id } });
          const data: {
            exerciseId: string;
            muscleId: string;
            structureId: string;
            role: string;
            emphasis: string | null;
            contributionWeight: number | null;
            confidence: number | null;
            notes: string | null;
            externalSourceId: string | null;
          }[] = [];
          for (const relation of input.structureRelations) {
            const muscle = await tx.muscle.findUnique({
              where: { slug: relation.muscleSlug },
              select: { id: true },
            });
            if (!muscle) throw new NotFoundError(`muscle ${relation.muscleSlug} not found`);
            const structure = await tx.muscleStructure.findUnique({
              where: { muscleId_slug: { muscleId: muscle.id, slug: relation.structureSlug } },
              select: { id: true, muscleId: true },
            });
            if (!structure) {
              throw new NotFoundError(
                `muscle structure ${relation.muscleSlug}/${relation.structureSlug} not found`,
              );
            }
            if (structure.muscleId !== muscle.id) {
              throw new NotFoundError(
                `muscle structure ${relation.structureSlug} does not belong to ${relation.muscleSlug}`,
              );
            }
            data.push({
              exerciseId: row.id,
              muscleId: structure.muscleId,
              structureId: structure.id,
              role: relation.role,
              emphasis: relation.emphasis ?? null,
              contributionWeight: relation.contributionWeight ?? null,
              confidence: relation.confidence ?? null,
              notes: relation.notes ?? null,
              externalSourceId: relation.externalSourceId ?? null,
            });
          }
          if (data.length > 0) await tx.exerciseMuscleStructureRelation.createMany({ data });
        }

        if (input.movementFunctions) {
          await tx.exerciseMovementFunction.deleteMany({ where: { exerciseId: row.id } });
          const data: { exerciseId: string; functionId: string; isPrimary: boolean }[] = [];
          for (const slug of new Set(input.movementFunctions)) {
            const fn = await tx.movementFunction.findUnique({ where: { slug }, select: { id: true } });
            if (!fn) throw new NotFoundError(`movement function ${slug} not found`);
            data.push({
              exerciseId: row.id,
              functionId: fn.id,
              isPrimary: slug === input.primaryMovementFunction,
            });
          }
          if (data.length > 0) await tx.exerciseMovementFunction.createMany({ data });
        }

        if (input.roles) {
          await tx.exerciseRoleAssignment.deleteMany({ where: { exerciseId: row.id } });
          const data = [...new Set(input.roles)].map((role, position) => ({
            exerciseId: row.id,
            role,
            position,
          }));
          if (data.length > 0) await tx.exerciseRoleAssignment.createMany({ data });
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
      // Caller-supplied order is not the database's business; return it sorted so
      // two identical reads can never differ by query plan.
      return rows
        .map((row) => exerciseRowToRecord(row))
        .sort((a, b) => a.slug.localeCompare(b.slug));
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

  async listMuscleTaxonomy(options?: { includeInactive?: boolean }): Promise<MuscleWithStructures[]> {
    return runDb(async () => {
      const rows = await this.prisma.muscle.findMany({
        where: options?.includeInactive ? undefined : { isActive: true },
        include: {
          structures: {
            where: options?.includeInactive ? undefined : { isActive: true },
            orderBy: { slug: "asc" },
          },
        },
        orderBy: { slug: "asc" },
      });
      return rows.map((row) => ({
        muscle: muscleRowToRecord(row),
        structures: row.structures.map((structure) => ({
          id: structure.id,
          muscleId: structure.muscleId,
          slug: structure.slug,
          name: structure.name,
          kind: structure.kind as MuscleStructureKind,
          displayName: structure.displayName ?? undefined,
          notes: structure.notes ?? undefined,
          isActive: structure.isActive,
          createdAt: toTimestamp(structure.createdAt),
          updatedAt: toTimestamp(structure.updatedAt),
        })),
      }));
    });
  }

  async findMuscleStructure(id: string): Promise<MuscleStructureRecord | null> {
    return runDb(async () => {
      const row = await this.prisma.muscleStructure.findUnique({ where: { id } });
      if (!row) return null;
      return {
        id: row.id,
        muscleId: row.muscleId,
        slug: row.slug,
        name: row.name,
        kind: row.kind as MuscleStructureKind,
        displayName: row.displayName ?? undefined,
        notes: row.notes ?? undefined,
        isActive: row.isActive,
        createdAt: toTimestamp(row.createdAt),
        updatedAt: toTimestamp(row.updatedAt),
      };
    });
  }

  async findExerciseKnowledge(idOrSlug: string): Promise<ExerciseKnowledgeRecord | null> {
    return runDb(async () => {
      const byId = await this.prisma.exercise.findFirst({
        where: { id: idOrSlug },
        include: KNOWLEDGE_INCLUDE,
      });
      if (byId) return exerciseKnowledgeRowToRecord(byId);
      const bySlug = await this.prisma.exercise.findFirst({
        where: { slug: idOrSlug },
        include: KNOWLEDGE_INCLUDE,
      });
      return bySlug ? exerciseKnowledgeRowToRecord(bySlug) : null;
    });
  }

  async listExerciseKnowledge(query?: SearchExercisesQuery): Promise<ExerciseKnowledgeRecord[]> {
    return runDb(async () => {
      const where: Record<string, unknown> = {};
      if (!query?.includeInactive) where["isActive"] = true;
      if (query?.q) {
        // Aliases are free text with display casing, so they are matched in
        // memory below; SQL handles the indexed text columns.
        where["OR"] = [
          { name: { contains: query.q, mode: "insensitive" } },
          { variationLabel: { contains: query.q, mode: "insensitive" } },
        ];
      }
      if (query?.category) where["category"] = query.category;
      if (query?.movementPattern) where["movementPattern"] = query.movementPattern;
      if (query?.muscleSlug || query?.structureSlug) {
        const muscle = query.muscleSlug
          ? await this.prisma.muscle.findUnique({ where: { slug: query.muscleSlug } })
          : (
              await this.prisma.muscleStructure.findFirst({
                where: { slug: query.structureSlug },
                include: { muscle: true },
              })
            )?.muscle;
        if (!muscle) return [];
        where["muscleRelations"] = { some: { muscleId: muscle.id } };
        if (query.structureSlug) {
          where["structureRelations"] = {
            some: {
              structure: {
                muscleId: muscle.id,
                ...(query.structureSlug ? { slug: query.structureSlug } : {}),
              },
            },
          };
        }
      }
      if (query?.movementFunction) {
        where["movementFunctions"] = {
          some: { function: { slug: query.movementFunction } },
        };
      }
      if (query?.role) where["roles"] = { some: { role: query.role } };
      if (query?.equipmentIds && query.equipmentIds.length > 0) {
        // All listed equipment is required simultaneously, so requiring every
        // requested piece is an AND of separate conditions.
        const and: unknown[] = Array.isArray(where["AND"]) ? (where["AND"] as unknown[]) : [];
        for (const equipmentId of query.equipmentIds) {
          and.push({ requiredEquipment: { some: { equipmentId } } });
        }
        where["AND"] = and;
      }

      const rows = await this.prisma.exercise.findMany({
        where,
        include: KNOWLEDGE_INCLUDE,
        orderBy: { slug: "asc" },
      });
      const records = rows.map(exerciseKnowledgeRowToRecord);
      if (!query?.q) return records;
      const needle = query.q.toLowerCase();
      return records.filter(
        (record) =>
          record.name.toLowerCase().includes(needle) ||
          (record.variationLabel ?? "").toLowerCase().includes(needle) ||
          record.aliases.some((alias) => alias.toLowerCase().includes(needle)),
      );
    });
  }

  async listMovementFunctions(): Promise<UpsertMovementFunctionInput[]> {
    return runDb(async () => {
      const rows = await this.prisma.movementFunction.findMany({
        where: { isActive: true },
        orderBy: { slug: "asc" },
      });
      return rows.map((row) => ({
        slug: row.slug,
        name: row.name,
        region: row.region,
        description: row.description ?? undefined,
      }));
    });
  }
}
