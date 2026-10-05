import type { PrismaClient } from "@prisma/client";
import type {
  ActivityRepository,
  BodyMeasurementRepository,
} from "./body";
import {
  PrismaActivityRepository,
  PrismaBodyMeasurementRepository,
} from "./body";
import type { ExerciseRepository } from "./catalog";
import { PrismaExerciseRepository } from "./catalog";
import type {
  DiagnosisRepository,
  InterventionRepository,
  RecommendationRepository,
} from "./coaching";
import {
  PrismaDiagnosisRepository,
  PrismaInterventionRepository,
  PrismaRecommendationRepository,
} from "./coaching";
import type { EquipmentRepository } from "./equipment";
import { PrismaEquipmentRepository } from "./equipment";
import type { GoalRepository } from "./goals";
import { PrismaGoalRepository } from "./goals";
import type { ProfileRepository, UserRepository } from "./identity";
import { PrismaProfileRepository, PrismaUserRepository } from "./identity";
import type { FoodRepository, MealRepository, NutritionRepository } from "./nutrition";
import {
  PrismaFoodRepository,
  PrismaMealRepository,
  PrismaNutritionRepository,
} from "./nutrition";
import type { TrainingPlanRepository, WorkoutRepository } from "./training";
import { PrismaTrainingPlanRepository, PrismaWorkoutRepository } from "./training";

export * from "./body";
export * from "./catalog";
export * from "./coaching";
export * from "./equipment";
export * from "./goals";
export * from "./identity";
export * from "./nutrition";
export * from "./training";
export { runDb, boundedLimit } from "./util";

/**
 * The persistence surface of the application: one entry per aggregate
 * (domain-driven boundaries, not one table each — milestone §11).
 */
export interface Repositories {
  users: UserRepository;
  profiles: ProfileRepository;
  goals: GoalRepository;
  equipment: EquipmentRepository;
  exercises: ExerciseRepository;
  trainingPlans: TrainingPlanRepository;
  workouts: WorkoutRepository;
  bodyMeasurements: BodyMeasurementRepository;
  activity: ActivityRepository;
  foods: FoodRepository;
  meals: MealRepository;
  nutrition: NutritionRepository;
  diagnoses: DiagnosisRepository;
  recommendations: RecommendationRepository;
  interventions: InterventionRepository;
}

/** Dependency-injection factory: application code depends on `Repositories`. */
export function createRepositories(prisma: PrismaClient): Repositories {
  return {
    users: new PrismaUserRepository(prisma),
    profiles: new PrismaProfileRepository(prisma),
    goals: new PrismaGoalRepository(prisma),
    equipment: new PrismaEquipmentRepository(prisma),
    exercises: new PrismaExerciseRepository(prisma),
    trainingPlans: new PrismaTrainingPlanRepository(prisma),
    workouts: new PrismaWorkoutRepository(prisma),
    bodyMeasurements: new PrismaBodyMeasurementRepository(prisma),
    activity: new PrismaActivityRepository(prisma),
    foods: new PrismaFoodRepository(prisma),
    meals: new PrismaMealRepository(prisma),
    nutrition: new PrismaNutritionRepository(prisma),
    diagnoses: new PrismaDiagnosisRepository(prisma),
    recommendations: new PrismaRecommendationRepository(prisma),
    interventions: new PrismaInterventionRepository(prisma),
  };
}
