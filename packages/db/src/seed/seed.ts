import type { PrismaClient } from "@prisma/client";
import { newUuidv7 } from "../ids";
import { createRepositories } from "../repositories";
import {
  SEED_DEV_USER,
  SEED_EQUIPMENT,
  SEED_EXERCISES,
  SEED_FOODS,
  SEED_FIXED_IDS,
  SEED_FIXTURE_LABEL,
  SEED_MUSCLES,
} from "./fixtures";

export { SEED_FIXTURE_LABEL };

/**
 * Idempotent development seed.
 *
 * Safe to run repeatedly: catalog rows upsert on their natural keys, fixture
 * foods and the dev user upsert on fixed ids, and no third-party dataset or
 * media is ever involved (see ./fixtures.ts).
 */
export interface SeedResult {
  equipment: number;
  muscles: number;
  exercises: number;
  foods: number;
  devUserId?: string;
  label: string;
}

export async function seedDatabase(prisma: PrismaClient): Promise<SeedResult> {
  const repos = createRepositories(prisma);

  let equipment = 0;
  for (const item of SEED_EQUIPMENT) {
    await repos.equipment.upsertCatalogItem(item);
    equipment += 1;
  }

  let muscles = 0;
  for (const muscle of SEED_MUSCLES) {
    await repos.exercises.upsertMuscle(muscle);
    muscles += 1;
  }

  const equipmentBySlug = new Map(
    (await repos.equipment.listCatalog()).map((item) => [item.slug, item.id]),
  );
  const muscleBySlug = new Map(
    (await repos.exercises.listMuscles({ includeInactive: true })).map((item) => [item.slug, item.id]),
  );

  let exercises = 0;
  for (const exercise of SEED_EXERCISES) {
    const requiredEquipmentIds = exercise.requiredEquipment.map((slug) => {
      const id = equipmentBySlug.get(slug);
      if (!id) throw new Error(`seed invariant: equipment ${slug} missing`);
      return id;
    });
    await repos.exercises.upsertExercise({
      slug: exercise.slug,
      name: exercise.name,
      category: exercise.category,
      movementPattern: exercise.movementPattern,
      requiredEquipmentIds,
      muscleRelations: exercise.relations.map((relation) => {
        const muscleId = muscleBySlug.get(relation.muscle);
        if (!muscleId) throw new Error(`seed invariant: muscle ${relation.muscle} missing`);
        return { muscleId, role: relation.role, contributionWeight: relation.weight };
      }),
    });
    exercises += 1;
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

  let foods = 0;
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
    foods += 1;
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
    equipment,
    muscles,
    exercises,
    foods,
    devUserId: SEED_DEV_USER.id,
    label: SEED_FIXTURE_LABEL,
  };
}
