import type { PrismaClient } from "@prisma/client";
import type {
  ExerciseMediaAngle,
  ExerciseMediaType,
} from "@fitcoach/domain";
import { ConstraintValidationError, NotFoundError } from "../errors";
import { newUuidv7 } from "../ids";
import { toTimestamp } from "../mapping";
import { runDb } from "./util";

/**
 * Phase 2 knowledge repository: structured form guidance, instructional-media
 * metadata and curated substitution edges.
 *
 * Three rules drive the shape here:
 *
 *   1. **Form guidance belongs to the exercise and is section/kind/position ordered.**
 *      Content is stored as active/inactive rows per exercise.
 *   2. **Media is metadata only.** Binaries live in object storage; this table
 *      stores keys, provenance, licence and versioning (docs/ARCHITECTURE.md
 *      §13, Phase 2 §29/§30).
 *   3. **Substitutions are handled at the domain level** via deterministic derivation
 *      in `fitness-core`; no persistence layer for substitutions.
 */

export interface FormGuidanceRecord {
  id: string;
  exerciseId: string;
  section: string;
  kind: string;
  content: string;
  position: number;
  isActive: boolean;
  externalSourceId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FormVersionRecord {
  id: string;
  exerciseId: string;
  version: number;
  status: string;
  effectiveFrom: string;
  reviewNotes?: string;
  steps: Array<{ key: string; heading: string; body: string; position: number }>;
  createdAt: string;
  updatedAt: string;
}

export interface SubstitutionRecord {
  id: string;
  fromExerciseId: string;
  toExerciseId: string;
  reason: string;
  similarity: number;
  createdAt: string;
}

export interface MediaAssetRecord {
  id: string;
  exerciseId: string;
  formVersionId?: string;
  type: ExerciseMediaType;
  angle?: ExerciseMediaAngle;
  url: string;
  caption?: string;
  isActive: boolean;
  externalSourceId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertFormGuidanceInput {
  exerciseId: string;
  section: string;
  kind: string;
  content: string;
  position: number;
  isActive?: boolean;
  externalSourceId?: string;
}

export interface UpsertMediaAssetInput {
  id?: string;
  exerciseId: string;
  formVersionId?: string;
  type: ExerciseMediaType;
  angle?: ExerciseMediaAngle;
  url: string;
  caption?: string;
  isActive?: boolean;
  externalSourceId?: string;
}

export interface UpsertFormVersionInput {
  exerciseId: string;
  version: number;
  status: string;
  effectiveFrom: string;
  reviewNotes?: string;
  steps: Array<{ key: string; heading: string; body: string; position: number }>;
}

export interface KnowledgeRepository {
  upsertFormGuidance(input: UpsertFormGuidanceInput): Promise<FormGuidanceRecord>;
  findFormGuidance(exerciseId: string, section: string, kind: string, position: number): Promise<FormGuidanceRecord | null>;
  listFormGuidance(exerciseId: string, activeOnly?: boolean): Promise<FormGuidanceRecord[]>;
  /** @deprecated Use listFormGuidance instead. Returns a synthetic form version for compatibility. */
  findActiveFormVersion(exerciseId: string): Promise<FormVersionRecord | null>;
  /** Upsert a complete form version (convenience for bulk operations). */
  upsertFormVersion(input: UpsertFormVersionInput): Promise<FormVersionRecord>;
  /** @deprecated Substitutions are now handled at domain level. Returns empty array. */
  listSubstitutions(exerciseId: string): Promise<SubstitutionRecord[]>;
  upsertMediaAsset(input: UpsertMediaAssetInput): Promise<MediaAssetRecord>;
  listMediaAssets(exerciseId: string, includeInactive?: boolean): Promise<MediaAssetRecord[]>;
  listAllMediaAssets(): Promise<MediaAssetRecord[]>;
}

function formRowToRecord(row: {
  id: string;
  exerciseId: string;
  section: string;
  kind: string;
  content: string;
  position: number;
  isActive: boolean;
  externalSourceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): FormGuidanceRecord {
  return {
    id: row.id,
    exerciseId: row.exerciseId,
    section: row.section,
    kind: row.kind,
    content: row.content,
    position: row.position,
    isActive: row.isActive,
    externalSourceId: row.externalSourceId ?? undefined,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

function mediaRowToRecord(row: {
  id: string;
  exerciseId: string;
  formVersionId: string | null;
  type: string;
  angle: string | null;
  url: string;
  caption: string | null;
  isActive: boolean;
  externalSourceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): MediaAssetRecord {
  return {
    id: row.id,
    exerciseId: row.exerciseId,
    formVersionId: row.formVersionId ?? undefined,
    type: row.type as ExerciseMediaType,
    angle: row.angle as ExerciseMediaAngle | undefined,
    url: row.url,
    caption: row.caption ?? undefined,
    isActive: row.isActive,
    externalSourceId: row.externalSourceId ?? undefined,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

const FORM_ORDER = ["key_points", "common_faults", "setup", "execution", "breathing", "progression"] as const;
const KIND_ORDER = ["demonstration", "explanation", "fault", "cue", "progression"] as const;

export class PrismaKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertFormGuidance(input: UpsertFormGuidanceInput): Promise<FormGuidanceRecord> {
    return runDb(async () =>
      this.prisma.$transaction(async (tx) => {
        const exercise = await tx.exercise.findUnique({
          where: { id: input.exerciseId },
          select: { id: true },
        });
        if (!exercise) throw new NotFoundError(`exercise ${input.exerciseId} not found`);

        // Validate section and kind
        if (!FORM_ORDER.includes(input.section as typeof FORM_ORDER[number])) {
          throw new ConstraintValidationError(`invalid form guidance section: ${input.section}`);
        }
        if (!KIND_ORDER.includes(input.kind as typeof KIND_ORDER[number])) {
          throw new ConstraintValidationError(`invalid form guidance kind: ${input.kind}`);
        }

        const row = await tx.exerciseFormVersion.upsert({
          where: {
            exerciseId_section_kind_position: {
              exerciseId: input.exerciseId,
              section: input.section,
              kind: input.kind,
              position: input.position,
            },
          },
          create: {
            id: newUuidv7(),
            exerciseId: input.exerciseId,
            section: input.section,
            kind: input.kind,
            content: input.content,
            position: input.position,
            isActive: input.isActive ?? true,
            externalSourceId: input.externalSourceId ?? null,
          },
          update: {
            content: input.content,
            isActive: input.isActive ?? true,
            externalSourceId: input.externalSourceId ?? null,
          },
        });
        return formRowToRecord(row);
      }),
    );
  }

  async findFormGuidance(
    exerciseId: string,
    section: string,
    kind: string,
    position: number
  ): Promise<FormGuidanceRecord | null> {
    return runDb(async () => {
      const row = await this.prisma.exerciseFormVersion.findUnique({
        where: {
          exerciseId_section_kind_position: {
            exerciseId,
            section,
            kind,
            position,
          },
        },
      });
      return row ? formRowToRecord(row) : null;
    });
  }

  async listFormGuidance(exerciseId: string, activeOnly = true): Promise<FormGuidanceRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.exerciseFormVersion.findMany({
        where: { exerciseId, ...(activeOnly ? { isActive: true } : {}) },
        orderBy: [
          { section: "asc" },
          { kind: "asc" },
          { position: "asc" },
        ],
      });
      return rows.map(formRowToRecord);
    });
  }

  async upsertMediaAsset(input: UpsertMediaAssetInput): Promise<MediaAssetRecord> {
    if (input.externalSourceId && !input.caption) {
      throw new ConstraintValidationError(
        "third-party media requires caption for attribution",
      );
    }
    return runDb(async () => {
      const where = input.id !== undefined
        ? { id: input.id }
        : {
            exerciseId_type_angle_formVersionId: {
              exerciseId: input.exerciseId,
              type: input.type,
              angle: input.angle ?? "",
              formVersionId: input.formVersionId ?? "",
            },
          };
      const row = await this.prisma.exerciseMediaAsset.upsert({
        where: where as any,
        create: {
          id: input.id ?? newUuidv7(),
          exerciseId: input.exerciseId,
          formVersionId: input.formVersionId ?? null,
          type: input.type,
          angle: input.angle ?? null,
          url: input.url,
          caption: input.caption ?? null,
          isActive: input.isActive ?? true,
          externalSourceId: input.externalSourceId ?? null,
        },
        update: {
          url: input.url,
          caption: input.caption ?? null,
          isActive: input.isActive ?? true,
          externalSourceId: input.externalSourceId ?? null,
        },
      });
      return mediaRowToRecord(row);
    });
  }

  async listMediaAssets(exerciseId: string, includeInactive = false): Promise<MediaAssetRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.exerciseMediaAsset.findMany({
        where: { exerciseId, ...(includeInactive ? {} : { isActive: true }) },
        orderBy: [{ type: "asc" }, { angle: "asc" }],
      });
      return rows.map(mediaRowToRecord);
    });
  }

  async listAllMediaAssets(): Promise<MediaAssetRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.exerciseMediaAsset.findMany({
        orderBy: [{ exerciseId: "asc" }, { type: "asc" }, { angle: "asc" }],
      });
      return rows.map(mediaRowToRecord);
    });
  }

  async findActiveFormVersion(exerciseId: string): Promise<FormVersionRecord | null> {
    return runDb(async () => {
      const rows = await this.prisma.exerciseFormVersion.findMany({
        where: { exerciseId, isActive: true },
        orderBy: [{ section: "asc" }, { kind: "asc" }, { position: "asc" }],
      });
      if (rows.length === 0) return null;

      const firstRow = rows[0]!;
      // Build a synthetic form version from the guidance rows
      const steps = rows.map((row) => ({
        key: `${row.section}:${row.kind}:${row.position}`,
        heading: row.section.replace(/_/g, " "),
        body: row.content,
        position: row.position,
      }));

      return {
        id: firstRow.id,
        exerciseId,
        version: 1,
        status: "active",
        effectiveFrom: toTimestamp(firstRow.createdAt),
        reviewNotes: undefined,
        steps,
        createdAt: toTimestamp(firstRow.createdAt),
        updatedAt: toTimestamp(firstRow.updatedAt),
      };
    });
  }

  async upsertFormVersion(input: UpsertFormVersionInput): Promise<FormVersionRecord> {
    return runDb(async () => {
      return this.prisma.$transaction(async (tx) => {
        // Delete existing guidance for this exercise/version
        await tx.exerciseFormVersion.deleteMany({
          where: { exerciseId: input.exerciseId },
        });

        // Create new guidance steps
        const createdSteps = [];
        for (const step of input.steps) {
          const row = await tx.exerciseFormVersion.create({
            data: {
              id: newUuidv7(),
              exerciseId: input.exerciseId,
              section: step.key.split(":")[0] ?? "general",
              kind: step.key.split(":")[1] ?? "key_points",
              content: step.body,
              position: step.position,
              isActive: input.status === "active",
            },
          });
          createdSteps.push(row);
        }

        const firstStep = createdSteps[0];
        return {
          id: firstStep?.id ?? newUuidv7(),
          exerciseId: input.exerciseId,
          version: input.version,
          status: input.status,
          effectiveFrom: input.effectiveFrom,
          reviewNotes: input.reviewNotes,
          steps: input.steps,
          createdAt: firstStep ? toTimestamp(firstStep.createdAt) : new Date().toISOString(),
          updatedAt: firstStep ? toTimestamp(firstStep.updatedAt) : new Date().toISOString(),
        };
      });
    });
  }

  async listSubstitutions(_exerciseId: string): Promise<SubstitutionRecord[]> {
    // Substitutions are handled at domain level in fitness-core; no persistence layer.
    return [];
  }
}