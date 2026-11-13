import type { PrismaClient } from "@prisma/client";
import type {
  ActivityRepository,
  BodyMeasurementRepository,
  PhysiqueGoalRepository,
  RecoveryRepository,
  SleepRepository,
} from "./body";
import {
  PrismaActivityRepository,
  PrismaBodyMeasurementRepository,
  PrismaPhysiqueGoalRepository,
  PrismaRecoveryRepository,
  PrismaSleepRepository,
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
import type {
  DecisionSnapshotRepository,
  DecisionInterventionRepository,
  DecisionEvidenceRepository,
  DecisionAssumptionRepository,
  DecisionOutcomeRepository,
} from "./decision";
import {
  PrismaDecisionSnapshotRepository,
  PrismaDecisionInterventionRepository,
  PrismaDecisionEvidenceRepository,
  PrismaDecisionAssumptionRepository,
  PrismaDecisionOutcomeRepository,
} from "./decision";
import type {
  ConversationRepository,
  ConversationMessageRepository,
} from "./conversation";
import {
  PrismaConversationRepository,
  PrismaConversationMessageRepository,
} from "./conversation";
import type { EquipmentRepository } from "./equipment";
import { PrismaEquipmentRepository } from "./equipment";
import type { TrainingEnvironmentRepository } from "./environments";
import { PrismaTrainingEnvironmentRepository } from "./environments";
import type { GoalRepository } from "./goals";
import { PrismaGoalRepository } from "./goals";
import type { ProfileRepository, UserRepository } from "./identity";
import { PrismaProfileRepository, PrismaUserRepository } from "./identity";
import type { KnowledgeRepository } from "./knowledge";
import { PrismaKnowledgeRepository } from "./knowledge";
import type { FoodRepository, MealRepository, NutritionRepository, RecipeRepository } from "./nutrition";
import {
  PrismaFoodRepository,
  PrismaMealRepository,
  PrismaNutritionRepository,
  PrismaRecipeRepository,
} from "./nutrition";
import type { ExercisePreferenceRepository } from "./preferences";
import { PrismaExercisePreferenceRepository } from "./preferences";
import type { ProgressionLedgerRepository } from "./progression";
import { PrismaProgressionLedgerRepository } from "./progression";
import type { TrainingPlanRepository, WorkoutRepository } from "./training";
import { PrismaTrainingPlanRepository, PrismaWorkoutRepository } from "./training";

export * from "./body";
export * from "./catalog";
export * from "./coaching";
export * from "./decision";
export * from "./conversation";
export * from "./equipment";
export * from "./environments";
export * from "./goals";
export * from "./identity";
export * from "./knowledge";
export * from "./nutrition";
export * from "./preferences";
export * from "./progression";
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
  knowledge: KnowledgeRepository;
  exercisePreferences: ExercisePreferenceRepository;
  trainingPlans: TrainingPlanRepository;
  trainingEnvironments: TrainingEnvironmentRepository;
  progressionLedger: ProgressionLedgerRepository;
  workouts: WorkoutRepository;
  bodyMeasurements: BodyMeasurementRepository;
  physiqueGoals: PhysiqueGoalRepository;
  activity: ActivityRepository;
  sleep: SleepRepository;
  recovery: RecoveryRepository;
  foods: FoodRepository;
  meals: MealRepository;
  recipes: RecipeRepository;
  nutrition: NutritionRepository;
  diagnoses: DiagnosisRepository;
  recommendations: RecommendationRepository;
  interventions: InterventionRepository;
  decisionSnapshots: DecisionSnapshotRepository;
  decisionInterventions: DecisionInterventionRepository;
  decisionEvidence: DecisionEvidenceRepository;
  decisionAssumptions: DecisionAssumptionRepository;
  decisionOutcomes: DecisionOutcomeRepository;
  conversations: ConversationRepository;
  conversationMessages: ConversationMessageRepository;
}

/** Dependency-injection factory: application code depends on `Repositories`. */
export function createRepositories(prisma: PrismaClient): Repositories {
  return {
    users: new PrismaUserRepository(prisma),
    profiles: new PrismaProfileRepository(prisma),
    goals: new PrismaGoalRepository(prisma),
    equipment: new PrismaEquipmentRepository(prisma),
    exercises: new PrismaExerciseRepository(prisma),
    knowledge: new PrismaKnowledgeRepository(prisma),
    exercisePreferences: new PrismaExercisePreferenceRepository(prisma),
    trainingPlans: new PrismaTrainingPlanRepository(prisma),
    trainingEnvironments: new PrismaTrainingEnvironmentRepository(prisma),
    progressionLedger: new PrismaProgressionLedgerRepository(prisma),
    workouts: new PrismaWorkoutRepository(prisma),
    bodyMeasurements: new PrismaBodyMeasurementRepository(prisma),
    physiqueGoals: new PrismaPhysiqueGoalRepository(prisma),
    activity: new PrismaActivityRepository(prisma),
    sleep: new PrismaSleepRepository(prisma),
    recovery: new PrismaRecoveryRepository(prisma),
    foods: new PrismaFoodRepository(prisma),
    meals: new PrismaMealRepository(prisma),
    recipes: new PrismaRecipeRepository(prisma),
    nutrition: new PrismaNutritionRepository(prisma),
    diagnoses: new PrismaDiagnosisRepository(prisma),
    recommendations: new PrismaRecommendationRepository(prisma),
    interventions: new PrismaInterventionRepository(prisma),
    decisionSnapshots: new PrismaDecisionSnapshotRepository(prisma),
    decisionInterventions: new PrismaDecisionInterventionRepository(prisma),
    decisionEvidence: new PrismaDecisionEvidenceRepository(prisma),
    decisionAssumptions: new PrismaDecisionAssumptionRepository(prisma),
    decisionOutcomes: new PrismaDecisionOutcomeRepository(prisma),
    conversations: new PrismaConversationRepository(prisma),
    conversationMessages: new PrismaConversationMessageRepository(prisma),
  };
}
