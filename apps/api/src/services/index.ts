import type { Repositories } from "@fitcoach/db";
import type { PrismaClient } from "@prisma/client";
import { ActivityService, BodyMeasurementService, SleepService, RecoveryService } from "./body";
import { BarcodeScannerService } from "./barcode";
import { CoachingService } from "./coaching";
import { TrainingContinuityService } from "./continuity";
import {
  ConversationOrchestrator,
  ResponseValidator,
  TypedActionRegistry,
} from "./aiCoaching";
import { EquipmentService, GoalService, ProfileService, UserService } from "./identity";
import { KnowledgeService } from "./knowledge";
import { NutritionService } from "./nutrition";
import { TrainingPlannerService } from "./planner";
import { TrainingService } from "./training";
import { RecipeService } from "./recipe";
import { PrismaNutritionTargetService } from "./nutritionTargets";
import { NutritionAssessmentService } from "./nutritionAssessment";
import { ActivityIntelligenceService, RecoveryIntelligenceService } from "./activityIntelligence";
import { BodyIntelligenceService, createBodyIntelligenceService } from "./bodyIntelligence";
import { UnifiedDecisionService, createUnifiedDecisionService } from "./unifiedDecision";
import { PersonalContextBuilder } from "./aiCoaching/contextBuilder";
import { AuthService, createAuthService } from "./auth";
import { createAIProvider } from "./aiProviderFactory";
import { RateLimitService, createRateLimitService } from "./rateLimit";
import { IdempotencyService, createIdempotencyService } from "./idempotency";
import { TokenBudgetService, createTokenBudgetService } from "./tokenBudget";
import { HealthService, AuditLogService, CleanupService, createHealthService, createAuditLogService, createCleanupService } from "./health";
export { AuthService, createAuthService } from "./auth";
export { authMiddleware, optionalAuthMiddleware, authAndOwnership, type AuthenticatedContext } from "./authMiddleware";
export { createAIProvider, getAIProviderName, type AIProviderName } from "./aiProviderFactory";
export { RateLimitService, createRateLimitService } from "./rateLimit";
export { IdempotencyService, createIdempotencyService } from "./idempotency";
export { TokenBudgetService, createTokenBudgetService } from "./tokenBudget";
export { HealthService, AuditLogService, CleanupService, createHealthService, createAuditLogService, createCleanupService } from "./health";

/**
 * Application/service layer (milestone §10):
 *
 *   domain → application/service (this) → repository → Prisma → PostgreSQL
 *
 * Services are plain classes constructed from the repository bundle, so any
 * route, test or future worker can inject a different implementation.
 */
export interface AppServices {
  users: UserService;
  profiles: ProfileService;
  goals: GoalService;
  equipment: EquipmentService;
  bodyMeasurements: BodyMeasurementService;
  activity: ActivityService;
  sleep: SleepService;
  recovery: RecoveryService;
  training: TrainingService;
  planner: TrainingPlannerService;
  continuity: TrainingContinuityService;
  knowledge: KnowledgeService;
  nutrition: NutritionService;
  coaching: CoachingService;
  recipes: RecipeService;
  nutritionTargets: PrismaNutritionTargetService;
  nutritionAssessment: NutritionAssessmentService;
  activityIntelligence: ActivityIntelligenceService;
  recoveryIntelligence: RecoveryIntelligenceService;
  bodyIntelligence: BodyIntelligenceService;
  barcode: BarcodeScannerService;
  unifiedDecision: UnifiedDecisionService;
  aiCoaching: ConversationOrchestrator;
  auth: AuthService;
  rateLimit: RateLimitService;
  idempotency: IdempotencyService;
  tokenBudget: TokenBudgetService;
  health: HealthService;
  auditLog: AuditLogService;
  cleanup: CleanupService;
}

export function createServices(repos: Repositories, prisma?: PrismaClient): AppServices {
  const planner = new TrainingPlannerService(repos);
  const profiles = new ProfileService(repos.profiles);
  const goals = new GoalService(repos.goals);
  const training = new TrainingService(repos);

  // Phase 9.3 coaching pipeline: provider-independent by construction.
  // Provider is selected by AI_PROVIDER env var (mock, anthropic, openai).
  // No silent fallbacks — missing API key throws at startup.
  const contextBuilder = new PersonalContextBuilder(repos);
  const actionRegistry = new TypedActionRegistry(repos);
  const validator = new ResponseValidator(actionRegistry);
  const aiCoaching = new ConversationOrchestrator({
    repos,
    provider: createAIProvider(),
    contextBuilder,
    actionRegistry,
    validator,
  });

  const isProduction = process.env.NODE_ENV === "production";

  // Production must have PrismaClient - no silent fallback to in-memory
  if (isProduction && !prisma) {
    throw new Error("PrismaClient required in production. Configure DATABASE_URL and run migrations.");
  }

  return {
    users: new UserService(repos.users),
    profiles,
    goals,
    equipment: new EquipmentService(repos.equipment, repos.users),
    bodyMeasurements: new BodyMeasurementService(repos.bodyMeasurements, repos.users),
    activity: new ActivityService(repos.activity, repos.users),
    sleep: new SleepService(repos.sleep, repos.users),
    recovery: new RecoveryService(repos.recovery, repos.users),
    training,
    planner,
    continuity: new TrainingContinuityService(repos),
    knowledge: new KnowledgeService(repos),
    nutrition: new NutritionService(repos),
    coaching: new CoachingService(repos),
    recipes: new RecipeService(repos),
    nutritionTargets: new PrismaNutritionTargetService(repos),
    nutritionAssessment: new NutritionAssessmentService(repos),
    activityIntelligence: new ActivityIntelligenceService(repos.activity, repos.workouts, profiles, goals, repos.nutrition, planner),
    recoveryIntelligence: new RecoveryIntelligenceService(repos.sleep, repos.recovery, repos.activity, repos.workouts, repos.nutrition, planner),
    bodyIntelligence: createBodyIntelligenceService(
      {
        bodyMeasurements: repos.bodyMeasurements,
        profiles: repos.profiles,
        physiqueGoals: repos.physiqueGoals,
      },
      training,
    ),
    barcode: new BarcodeScannerService(repos, new PrismaNutritionTargetService(repos)),
    unifiedDecision: createUnifiedDecisionService(repos),
    aiCoaching,
    auth: (() => {
      const auth = createAuthService();
      auth.setUserRepository(repos.users);
      return auth;
    })(),
    rateLimit: createRateLimitService(prisma),
    idempotency: createIdempotencyService({}, prisma),
    tokenBudget: createTokenBudgetService({ strictMode: isProduction }, prisma),
    health: createHealthService(repos),
    auditLog: createAuditLogService(repos),
    cleanup: createCleanupService(),
  };
}

export { ActivityService, BodyMeasurementService, SleepService, RecoveryService } from "./body";
export { CoachingService } from "./coaching";
export { EquipmentService, GoalService, ProfileService, UserService } from "./identity";
export { NutritionService } from "./nutrition";
export { TrainingService } from "./training";
export { TrainingPlannerService } from "./planner";
export { TrainingContinuityService } from "./continuity";
export { KnowledgeService } from "./knowledge";
export { RecipeService } from "./recipe";
export { PrismaNutritionTargetService } from "./nutritionTargets";
export { NutritionAssessmentService } from "./nutritionAssessment";
export { ActivityIntelligenceService, RecoveryIntelligenceService } from "./activityIntelligence";
export type { BodyIntelligenceService } from "./bodyIntelligence";
export { createBodyIntelligenceService } from "./bodyIntelligence";
export { UnifiedDecisionService, createUnifiedDecisionService } from "./unifiedDecision";
