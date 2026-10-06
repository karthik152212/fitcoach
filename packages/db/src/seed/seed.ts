import type { PrismaClient } from "@prisma/client";
import { newUuidv7 } from "../ids";
import { createRepositories } from "../repositories";
import {
  KNOWLEDGE_EXERCISES,
  KNOWLEDGE_SUBSTITUTIONS,
  defaultMediaFor,
} from "./knowledgeExercises";
import {
  KNOWLEDGE_EQUIPMENT,
  KNOWLEDGE_MOVEMENT_FUNCTIONS,
  KNOWLEDGE_MUSCLES,
} from "./knowledgeTaxonomy";
import { formSteps } from "./knowledgeTypes";
import {
  SEED_DEV_USER,
  SEED_FOODS,
  SEED_FIXED_IDS,
  SEED_FIXTURE_LABEL,
} from "./fixtures";

export { SEED_FIXTURE_LABEL };

/**
 * Idempotent development seed.
 *
 * Safe to run repeatedly:
 *   * equipment, muscles, muscle structures, movement functions, exercises and
 *     exercise knowledge all upsert on their natural keys (slug, (muscle,
 *     structure), (exercise, type, angle, version), (exercise, version));
 *   * relation sets are replaced wholesale inside one transaction, so a
 *     re-import converges instead of accumulating stale rows;
 *   * form guidance is versioned — the same content resolves to the same
 *     version rather than creating a new one every run;
 *   * fixture foods and the dev user upsert on fixed ids;
 *   * no third-party dataset or media is ever involved (see ./fixtures.ts and
 *     data/provenance/THIRD_PARTY.md).
 *
 * Every exercise requires at least one target muscle, so a catalog entry can
 * never be "known" without saying what it trains. Nothing is deleted: content
 * that disappears from the fixtures is retired by an explicit
 * `is_active` change, never removed.
 */
export interface SeedResult {
  equipment: number;
  muscles: number;
  muscleStructures: number;
  movementFunctions: number;
  exercises: number;
  formVersions: number;
  mediaAssets: number;
  substitutions: number;
  foods: number;
  devUserId?: string;
  label: string;
}

export async function seedDatabase(prisma: PrismaClient): Promise<SeedResult> {
  const repos = createRepositories(prisma);

  for (const item of KNOWLEDGE_EQUIPMENT) {
    await repos.equipment.upsertCatalogItem({
      slug: item.slug,
      name: item.name,
      category: item.category,
    });
  }

  for (const muscle of KNOWLEDGE_MUSCLES) {
    await repos.exercises.upsertMuscle({
      slug: muscle.slug,
      name: muscle.name,
      group: muscle.group,
      displayName: muscle.displayName,
    });
  }
  for (const muscle of KNOWLEDGE_MUSCLES) {
    for (const structure of muscle.structures ?? []) {
      await repos.exercises.upsertMuscleStructure({
        muscleSlug: muscle.slug,
        slug: structure.slug,
        name: structure.name,
        kind: structure.kind,
        displayName: structure.displayName,
        ...(structure.notes !== undefined ? { notes: structure.notes } : {}),
      });
    }
  }

  for (const fn of KNOWLEDGE_MOVEMENT_FUNCTIONS) {
    await repos.exercises.upsertMovementFunction({
      slug: fn.slug,
      name: fn.name,
      region: fn.region,
      description: fn.description,
    });
  }

  const muscleBySlug = new Map(
    (await repos.exercises.listMuscles({ includeInactive: true })).map((item) => [
      item.slug,
      item.id,
    ]),
  );

  // The fixed seed day keeps the catalog's form-guidance validity independent
  // of when the seed happens to run, so re-running it years later produces the
  // same rows instead of a new "active from today" version.
  const SEED_EFFECTIVE_FROM = "2026-01-01";

  let formVersions = 0;
  let mediaAssets = 0;

  for (const exercise of KNOWLEDGE_EXERCISES) {
    if (exercise.relations.length === 0) {
      throw new Error(`seed invariant: ${exercise.slug} declares no target muscle`);
    }
    for (const relation of exercise.relations) {
      if (!muscleBySlug.has(relation.muscle)) {
        throw new Error(`seed invariant: muscle ${relation.muscle} missing`);
      }
    }

    const record = await repos.exercises.upsertExercise({
      slug: exercise.slug,
      name: exercise.name,
      ...(exercise.aliases ? { aliases: exercise.aliases } : {}),
      category: exercise.category,
      ...(exercise.movementPattern !== undefined ? { movementPattern: exercise.movementPattern } : {}),
      ...(exercise.unilateral !== undefined ? { unilateral: exercise.unilateral } : {}),
      instructions: exercise.summary,
      variationKey: exercise.variationKey,
      variationLabel: exercise.variationLabel,
      stabilityDemand: exercise.stabilityDemand,
      loadingCharacteristic: exercise.loadingCharacteristic,
      rangeOfMotionCharacteristic: exercise.rangeOfMotionCharacteristic,
      requiredEquipment: exercise.equipment,
      movementFunctions: exercise.movementFunctions,
      primaryMovementFunction: exercise.primaryMovementFunction,
      roles: exercise.roles,
      relations: exercise.relations.map((relation) => ({
        muscleSlug: relation.muscle,
        role: relation.role,
        contributionWeight: relation.weight,
        emphasis: relation.emphasis,
        confidence: relation.confidence,
        notes: relation.notes,
      })),
      ...(exercise.structureRelations
        ? {
            structureRelations: exercise.structureRelations.map((relation) => ({
              muscleSlug: relation.muscle,
              structureSlug: relation.structure,
              role: relation.role,
              contributionWeight: relation.weight,
              emphasis: relation.emphasis,
              confidence: relation.confidence,
              notes: relation.notes,
            })),
          }
        : {}),
    });

    const steps = formSteps(exercise.form);
    if (steps.length === 0) {
      throw new Error(`seed invariant: ${exercise.slug} declares no form guidance`);
    }
    const existingVersion = await repos.knowledge.findActiveFormVersion(record.id);
    if (!existingVersion) {
      await repos.knowledge.upsertFormVersion({
        exerciseId: record.id,
        version: 1,
        status: "active",
        effectiveFrom: SEED_EFFECTIVE_FROM,
        reviewNotes: "First-party FitCoach-reviewed form guidance (initial catalog import).",
        steps,
      });
      formVersions += 1;
    } else {
      // Content already published for this version: never edit steps in place
      // (they are append-only). A genuine improvement ships as version N+1.
      const sameContent =
        existingVersion.steps.length === steps.length &&
        existingVersion.steps.every((step, index) => {
          const candidate = steps[index];
          return (
            candidate !== undefined &&
            step.key === candidate.key &&
            step.heading === candidate.heading &&
            step.body === candidate.body
          );
        });
      if (!sameContent) {
        await repos.knowledge.upsertFormVersion({
          exerciseId: record.id,
          status: "active",
          effectiveFrom: SEED_EFFECTIVE_FROM,
          reviewNotes: "Form guidance revised by review; published as a new version.",
          steps,
        });
        formVersions += 1;
      }
    }

    for (const media of exercise.media ?? defaultMediaFor(exercise)) {
      await repos.knowledge.upsertMediaAsset({
        exerciseId: record.id,
        mediaType: media.mediaType,
        angle: media.angle,
        storageKey: media.storageKey,
        durationSeconds: media.durationSeconds,
        overlays: media.overlays,
        status: media.status ?? "active",
        effectiveFrom: SEED_EFFECTIVE_FROM,
      });
      mediaAssets += 1;
    }
  }

  const exerciseBySlug = new Map(
    (await repos.exercises.listExercises({ includeInactive: true })).map((item) => [
      item.slug,
      item.id,
    ]),
  );

  for (const substitution of KNOWLEDGE_SUBSTITUTIONS) {
    const exerciseId = exerciseBySlug.get(substitution.exercise);
    const substituteId = exerciseBySlug.get(substitution.substitute);
    if (!exerciseId || !substituteId) {
      throw new Error(
        `seed invariant: substitution ${substitution.exercise} -> ${substitution.substitute} references a missing exercise`,
      );
    }
    await repos.knowledge.upsertSubstitution({
      exerciseId,
      substituteExerciseId: substituteId,
      trigger: substitution.trigger,
      reason: substitution.reason,
      rankHint: substitution.rankHint ?? 0,
    });
  }

  // Food source + fixture foods (first-party, hand-written values).
  await prisma.foodSource.upsert({
    where: { id: SEED_FIXED_IDS.foodSource },
    create: {
      id: SEED_FIXED_IDS.foodSource,
      name: "FitCoach development fixtures",
      kind: "estimate",
      defaultConfidence: "estimated",
    },
    update: { name: "FitCoach development fixtures" },
  });

  for (const food of SEED_FOODS) {
    await prisma.food.upsert({
      where: { id: food.id },
      create: {
        id: food.id,
        sourceId: SEED_FIXED_IDS.foodSource,
        name: food.name,
        densityBasis: food.densityBasis,
        caloriesKcal: food.nutrients.caloriesKcal,
        proteinG: food.nutrients.proteinGrams,
        carbohydrateG: food.nutrients.carbohydrateGrams,
        fatG: food.nutrients.fatGrams,
        fiberG: food.nutrients.fiberGrams ?? null,
      },
      update: {
        name: food.name,
        caloriesKcal: food.nutrients.caloriesKcal,
        proteinG: food.nutrients.proteinGrams,
        carbohydrateG: food.nutrients.carbohydrateGrams,
        fatG: food.nutrients.fatGrams,
        fiberG: food.nutrients.fiberGrams ?? null,
      },
    });
    const serving = await prisma.foodServing.findFirst({
      where: { foodId: food.id, label: food.serving.label },
    });
    if (!serving) {
      await prisma.foodServing.create({
        data: {
          id: newUuidv7(),
          foodId: food.id,
          label: food.serving.label,
          grams: food.serving.grams,
        },
      });
    }
  }

  // Labeled development user (never production data).
  await prisma.user.upsert({
    where: { id: SEED_DEV_USER.id },
    create: {
      id: SEED_DEV_USER.id,
      email: SEED_DEV_USER.email,
      displayName: SEED_DEV_USER.displayName,
      timezone: SEED_DEV_USER.timezone,
    },
    update: {
      email: SEED_DEV_USER.email,
      displayName: SEED_DEV_USER.displayName,
      timezone: SEED_DEV_USER.timezone,
    },
  });
  await prisma.profile.upsert({
    where: { userId: SEED_DEV_USER.id },
    create: {
      userId: SEED_DEV_USER.id,
      sex: SEED_DEV_USER.profile.sex,
      heightCm: SEED_DEV_USER.profile.heightCm,
      trainingExperience: SEED_DEV_USER.profile.trainingExperience,
      trainingDaysPerWeek: SEED_DEV_USER.profile.trainingDaysPerWeek,
      sessionDurationMinutes: SEED_DEV_USER.profile.sessionDurationMinutes,
      limitations: [],
      unitSystem: SEED_DEV_USER.profile.unitSystem,
    },
    update: {
      sex: SEED_DEV_USER.profile.sex,
      heightCm: SEED_DEV_USER.profile.heightCm,
      trainingExperience: SEED_DEV_USER.profile.trainingExperience,
      trainingDaysPerWeek: SEED_DEV_USER.profile.trainingDaysPerWeek,
      sessionDurationMinutes: SEED_DEV_USER.profile.sessionDurationMinutes,
      unitSystem: SEED_DEV_USER.profile.unitSystem,
    },
  });

  return {
    equipment: KNOWLEDGE_EQUIPMENT.length,
    muscles: KNOWLEDGE_MUSCLES.length,
    muscleStructures: KNOWLEDGE_MUSCLES.reduce(
      (total, muscle) => total + (muscle.structures?.length ?? 0),
      0,
    ),
    movementFunctions: KNOWLEDGE_MOVEMENT_FUNCTIONS.length,
    exercises: KNOWLEDGE_EXERCISES.length,
    formVersions,
    mediaAssets,
    substitutions: KNOWLEDGE_SUBSTITUTIONS.length,
    foods: SEED_FOODS.length,
    devUserId: SEED_DEV_USER.id,
    label: SEED_FIXTURE_LABEL,
  };
}
