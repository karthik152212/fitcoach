import type { PrismaClient } from "@prisma/client";
import type {
  ExerciseMediaAngle,
  ExerciseMediaType,
  FormGuidanceStatus,
  FormGuidanceStepKey,
  FormOverlayKind,
} from "@fitcoach/domain";
import { ConflictError, ConstraintValidationError, NotFoundError } from "../errors";
import { newUuidv7 } from "../ids";
import { toCalendarDate, toTimestamp } from "../mapping";
import { runDb } from "./util";

/**
 * Phase 2 knowledge repository: structured form guidance, instructional-media
 * metadata and curated substitution edges.
 *
 * Three rules drive the shape here:
 *
 *   1. **Form guidance belongs to the variation and is versioned.** A new
 *      version is a new row and the previous one is retired, so instructional
 *      content can improve without any historical record changing meaning.
 *   2. **Media is metadata only.** Binaries live in object storage; this table
 *      stores keys, provenance, licence and versioning (docs/ARCHITECTURE.md
 *      §13, Phase 2 §29/§30).
 *   3. **Substitutions are a hint layer, not a lookup table.** The default
 *      path is deterministic derivation in `fitness-core`; a row here records a
 *      reviewed replacement with its reason, and never replaces derivation.
 */

export interface FormGuidanceStepRecord {
  key: FormGuidanceStepKey;
  heading: string;
  body: string;
  position: number;
}

export interface FormGuidanceVersionRecord {
  id: string;
  exerciseId: string;
  version: number;
  status: FormGuidanceStatus;
  effectiveFrom: string;
  retiredOn?: string;
  reviewNotes?: string;
  externalSourceId?: string;
  steps: FormGuidanceStepRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface MediaAssetRecord {
  id: string;
  exerciseId: string;
  mediaType: ExerciseMediaType;
  angle: ExerciseMediaAngle;
  storageKey: string;
  durationSeconds?: number;
  widthPx?: number;
  heightPx?: number;
  contentVersion: number;
  status: "active" | "retired";
  overlays: FormOverlayKind[];
  externalSourceId?: string;
  licenseSpdx?: string;
  attributionRequired: boolean;
  attributionText?: string;
  importedVersion?: string;
  effectiveFrom: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubstitutionRecord {
  id: string;
  exerciseId: string;
  substituteExerciseId: string;
  trigger: "default" | "machine_busy" | "equipment_missing" | "disliked";
  reason: string;
  rankHint: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertFormVersionInput {
  exerciseId: string;
  /** Omit to create the next version for this exercise. */
  version?: number;
  status?: FormGuidanceStatus;
  effectiveFrom: string;
  reviewNotes?: string;
  externalSourceId?: string;
  steps: readonly FormGuidanceStepRecord[];
}

export interface UpsertMediaAssetInput {
  id?: string;
  exerciseId: string;
  mediaType: ExerciseMediaType;
  angle: ExerciseMediaAngle;
  storageKey: string;
  durationSeconds?: number;
  widthPx?: number;
  heightPx?: number;
  contentVersion?: number;
  status?: "active" | "retired";
  overlays?: readonly FormOverlayKind[];
  externalSourceId?: string;
  licenseSpdx?: string;
  attributionRequired?: boolean;
  attributionText?: string;
  importedVersion?: string;
  effectiveFrom: string;
}

export interface UpsertSubstitutionInput {
  id?: string;
  exerciseId: string;
  substituteExerciseId: string;
  trigger: "default" | "machine_busy" | "equipment_missing" | "disliked";
  reason: string;
  rankHint?: number;
  isActive?: boolean;
}

export interface KnowledgeRepository {
  upsertFormVersion(input: UpsertFormVersionInput): Promise<FormGuidanceVersionRecord>;
  findActiveFormVersion(exerciseId: string): Promise<FormGuidanceVersionRecord | null>;
  listFormVersions(exerciseId: string): Promise<FormGuidanceVersionRecord[]>;
  upsertMediaAsset(input: UpsertMediaAssetInput): Promise<MediaAssetRecord>;
  listMediaAssets(exerciseId: string, includeRetired?: boolean): Promise<MediaAssetRecord[]>;
  listAllMediaAssets(): Promise<MediaAssetRecord[]>;
  upsertSubstitution(input: UpsertSubstitutionInput): Promise<SubstitutionRecord>;
  listSubstitutions(exerciseId: string): Promise<SubstitutionRecord[]>;
  listAllSubstitutions(): Promise<SubstitutionRecord[]>;
}

const FORM_STEP_ORDER: readonly FormGuidanceStepKey[] = [
  "setup",
  "body_position",
  "grip",
  "start_position",
  "movement_path",
  "joint_path",
  "range_of_motion",
  "tempo_and_control",
  "breathing",
  "bracing",
  "end_position",
  "common_mistakes",
  "coaching_cues",
  "intended_target",
  "safety_notes",
];

function parseDate(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ConstraintValidationError(`${field} must be YYYY-MM-DD`);
  }
  return new Date(`${value}T00:00:00.000Z`);
}

function formRowToRecord(row: {
  id: string;
  exerciseId: string;
  version: number;
  status: string;
  effectiveFrom: Date;
  retiredOn: Date | null;
  reviewNotes: string | null;
  externalSourceId: string | null;
  createdAt: Date;
  updatedAt: Date;
  steps?: Array<{ stepKey: string; heading: string; body: string; position: number }>;
}): FormGuidanceVersionRecord {
  return {
    id: row.id,
    exerciseId: row.exerciseId,
    version: row.version,
    status: row.status as FormGuidanceStatus,
    effectiveFrom: toCalendarDate(row.effectiveFrom),
    retiredOn: row.retiredOn ? toCalendarDate(row.retiredOn) : undefined,
    reviewNotes: row.reviewNotes ?? undefined,
    externalSourceId: row.externalSourceId ?? undefined,
    steps: (row.steps ?? [])
      .map((step) => ({
        key: step.stepKey as FormGuidanceStepKey,
        heading: step.heading,
        body: step.body,
        position: step.position,
      }))
      .sort((a, b) => a.position - b.position),
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

function mediaRowToRecord(row: {
  id: string;
  exerciseId: string;
  mediaType: string;
  angle: string;
  storageKey: string;
  durationSeconds: number | null;
  widthPx: number | null;
  heightPx: number | null;
  contentVersion: number;
  status: string;
  overlays: string[];
  externalSourceId: string | null;
  licenseSpdx: string | null;
  attributionRequired: boolean;
  attributionText: string | null;
  importedVersion: string | null;
  effectiveFrom: Date;
  createdAt: Date;
  updatedAt: Date;
}): MediaAssetRecord {
  return {
    id: row.id,
    exerciseId: row.exerciseId,
    mediaType: row.mediaType as ExerciseMediaType,
    angle: row.angle as ExerciseMediaAngle,
    storageKey: row.storageKey,
    durationSeconds: row.durationSeconds ?? undefined,
    widthPx: row.widthPx ?? undefined,
    heightPx: row.heightPx ?? undefined,
    contentVersion: row.contentVersion,
    status: row.status as "active" | "retired",
    overlays: (row.overlays ?? []) as FormOverlayKind[],
    externalSourceId: row.externalSourceId ?? undefined,
    licenseSpdx: row.licenseSpdx ?? undefined,
    attributionRequired: row.attributionRequired,
    attributionText: row.attributionText ?? undefined,
    importedVersion: row.importedVersion ?? undefined,
    effectiveFrom: toCalendarDate(row.effectiveFrom),
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

function substitutionRowToRecord(row: {
  id: string;
  exerciseId: string;
  substituteExerciseId: string;
  trigger: string;
  reason: string;
  rankHint: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SubstitutionRecord {
  return {
    id: row.id,
    exerciseId: row.exerciseId,
    substituteExerciseId: row.substituteExerciseId,
    trigger: row.trigger as SubstitutionRecord["trigger"],
    reason: row.reason,
    rankHint: row.rankHint,
    isActive: row.isActive,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

const FORM_INCLUDE = { steps: { orderBy: { position: "asc" as const } } } as const;

export class PrismaKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertFormVersion(input: UpsertFormVersionInput): Promise<FormGuidanceVersionRecord> {
    const effectiveFrom = parseDate(input.effectiveFrom, "effectiveFrom");
    const status = input.status ?? "active";

    // Ordered by the canonical guidance order, not by the caller's array, so a
    // re-import of the same content is byte-identical and stays idempotent.
    const ordered = [...input.steps].sort((a, b) => {
      const ai = FORM_STEP_ORDER.indexOf(a.key);
      const bi = FORM_STEP_ORDER.indexOf(b.key);
      if (ai !== bi) return ai - bi;
      return a.key.localeCompare(b.key);
    });
    const seen = new Set<string>();
    for (const step of ordered) {
      if (seen.has(step.key)) {
        throw new ConstraintValidationError(`duplicate form guidance step: ${step.key}`);
      }
      seen.add(step.key);
    }

    return runDb(async () =>
      this.prisma.$transaction(async (tx) => {
        const exercise = await tx.exercise.findUnique({
          where: { id: input.exerciseId },
          select: { id: true },
        });
        if (!exercise) throw new NotFoundError(`exercise ${input.exerciseId} not found`);

        const version =
          input.version ??
          ((await tx.exerciseFormVersion.findFirst({
            where: { exerciseId: input.exerciseId },
            orderBy: { version: "desc" },
            select: { version: true },
          }))?.version ?? 0) + 1;

        // Activating a version retires the previous one; the row is never
        // rewritten, so an old citation still resolves to the old content.
        if (status === "active") {
          await tx.exerciseFormVersion.updateMany({
            where: { exerciseId: input.exerciseId, status: "active" },
            data: { status: "retired", retiredOn: effectiveFrom },
          });
        }

        const row = await tx.exerciseFormVersion.upsert({
          where: { exerciseId_version: { exerciseId: input.exerciseId, version } },
          create: {
            id: newUuidv7(),
            exerciseId: input.exerciseId,
            version,
            status,
            effectiveFrom,
            reviewNotes: input.reviewNotes ?? null,
            externalSourceId: input.externalSourceId ?? null,
          },
          update: {},
          include: FORM_INCLUDE,
        });

        // Steps are append-only (trigger-enforced), so a changed version is a
        // new version number rather than an edit of published content.
        const existingSteps = await tx.exerciseFormStep.findMany({
          where: { formVersionId: row.id },
        });
        if (existingSteps.length === 0 && ordered.length > 0) {
          await tx.exerciseFormStep.createMany({
            data: ordered.map((step, position) => ({
              id: newUuidv7(),
              formVersionId: row.id,
              stepKey: step.key,
              heading: step.heading,
              body: step.body,
              position,
            })),
          });
        }

        const full = await tx.exerciseFormVersion.findUnique({
          where: { id: row.id },
          include: FORM_INCLUDE,
        });
        if (!full) throw new NotFoundError("form version disappeared after upsert");
        return formRowToRecord(full);
      }),
    );
  }

  async findActiveFormVersion(exerciseId: string): Promise<FormGuidanceVersionRecord | null> {
    return runDb(async () => {
      const row = await this.prisma.exerciseFormVersion.findFirst({
        where: { exerciseId, status: "active" },
        orderBy: { version: "desc" },
        include: FORM_INCLUDE,
      });
      return row ? formRowToRecord(row) : null;
    });
  }

  async listFormVersions(exerciseId: string): Promise<FormGuidanceVersionRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.exerciseFormVersion.findMany({
        where: { exerciseId },
        orderBy: { version: "desc" },
        include: FORM_INCLUDE,
      });
      return rows.map(formRowToRecord);
    });
  }

  async upsertMediaAsset(input: UpsertMediaAssetInput): Promise<MediaAssetRecord> {
    const effectiveFrom = parseDate(input.effectiveFrom, "effectiveFrom");
    if (input.externalSourceId && !input.licenseSpdx) {
      throw new ConstraintValidationError(
        "third-party media requires licenseSpdx (provenance and licence travel together)",
      );
    }
    return runDb(async () => {
      const version = input.contentVersion ?? 1;
      const where =
        input.id !== undefined
          ? { id: input.id }
          : {
              exerciseId_mediaType_angle_contentVersion: {
                exerciseId: input.exerciseId,
                mediaType: input.mediaType,
                angle: input.angle,
                contentVersion: version,
              },
            };
      const row = await this.prisma.exerciseMediaAsset.upsert({
        where,
        create: {
          id: input.id ?? newUuidv7(),
          exerciseId: input.exerciseId,
          mediaType: input.mediaType,
          angle: input.angle,
          storageKey: input.storageKey,
          durationSeconds: input.durationSeconds ?? null,
          widthPx: input.widthPx ?? null,
          heightPx: input.heightPx ?? null,
          contentVersion: version,
          status: input.status ?? "active",
          overlays: [...(input.overlays ?? [])],
          externalSourceId: input.externalSourceId ?? null,
          licenseSpdx: input.licenseSpdx ?? null,
          attributionRequired: input.attributionRequired ?? false,
          attributionText: input.attributionText ?? null,
          importedVersion: input.importedVersion ?? null,
          effectiveFrom,
        },
        update: {
          storageKey: input.storageKey,
          durationSeconds: input.durationSeconds ?? null,
          widthPx: input.widthPx ?? null,
          heightPx: input.heightPx ?? null,
          status: input.status ?? "active",
          overlays: [...(input.overlays ?? [])],
          licenseSpdx: input.licenseSpdx ?? null,
          attributionRequired: input.attributionRequired ?? false,
          attributionText: input.attributionText ?? null,
          importedVersion: input.importedVersion ?? null,
        },
      });
      return mediaRowToRecord(row);
    });
  }

  async listMediaAssets(exerciseId: string, includeRetired = false): Promise<MediaAssetRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.exerciseMediaAsset.findMany({
        where: { exerciseId, ...(includeRetired ? {} : { status: "active" }) },
        orderBy: [{ mediaType: "asc" }, { angle: "asc" }, { contentVersion: "desc" }],
      });
      return rows.map(mediaRowToRecord);
    });
  }

  async listAllMediaAssets(): Promise<MediaAssetRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.exerciseMediaAsset.findMany({
        orderBy: [{ exerciseId: "asc" }, { mediaType: "asc" }, { angle: "asc" }],
      });
      return rows.map(mediaRowToRecord);
    });
  }

  async upsertSubstitution(input: UpsertSubstitutionInput): Promise<SubstitutionRecord> {
    if (input.exerciseId === input.substituteExerciseId) {
      throw new ConflictError("an exercise cannot substitute for itself");
    }
    return runDb(async () => {
      const row = await this.prisma.exerciseSubstitution.upsert({
        where: {
          exerciseId_substituteExerciseId_trigger: {
            exerciseId: input.exerciseId,
            substituteExerciseId: input.substituteExerciseId,
            trigger: input.trigger,
          },
        },
        create: {
          id: input.id ?? newUuidv7(),
          exerciseId: input.exerciseId,
          substituteExerciseId: input.substituteExerciseId,
          trigger: input.trigger,
          reason: input.reason,
          rankHint: input.rankHint ?? 0,
          isActive: input.isActive ?? true,
        },
        update: {
          reason: input.reason,
          rankHint: input.rankHint ?? 0,
          isActive: input.isActive ?? true,
        },
      });
      return substitutionRowToRecord(row);
    });
  }

  async listSubstitutions(exerciseId: string): Promise<SubstitutionRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.exerciseSubstitution.findMany({
        where: { exerciseId },
        orderBy: [{ rankHint: "desc" }, { substituteExerciseId: "asc" }],
      });
      return rows.map(substitutionRowToRecord);
    });
  }

  async listAllSubstitutions(): Promise<SubstitutionRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.exerciseSubstitution.findMany({
        orderBy: [{ exerciseId: "asc" }, { rankHint: "desc" }],
      });
      return rows.map(substitutionRowToRecord);
    });
  }
}
