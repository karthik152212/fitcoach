import type { Repositories } from "@fitcoach/db";
import { ActivityService, BodyMeasurementService } from "./body";
import { CoachingService } from "./coaching";
import { EquipmentService, GoalService, ProfileService, UserService } from "./identity";
import { KnowledgeService } from "./knowledge";
import { NutritionService } from "./nutrition";
import { TrainingService } from "./training";

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
  training: TrainingService;
  knowledge: KnowledgeService;
  nutrition: NutritionService;
  coaching: CoachingService;
}

export function createServices(repos: Repositories): AppServices {
  return {
    users: new UserService(repos.users),
    profiles: new ProfileService(repos.profiles),
    goals: new GoalService(repos.goals),
    equipment: new EquipmentService(repos.equipment, repos.users),
    bodyMeasurements: new BodyMeasurementService(repos.bodyMeasurements, repos.users),
    activity: new ActivityService(repos.activity, repos.users),
    training: new TrainingService(repos),
    knowledge: new KnowledgeService(repos),
    nutrition: new NutritionService(repos),
    coaching: new CoachingService(repos),
  };
}

export { ActivityService, BodyMeasurementService } from "./body";
export { CoachingService } from "./coaching";
export { EquipmentService, GoalService, ProfileService, UserService } from "./identity";
export { NutritionService } from "./nutrition";
export { TrainingService } from "./training";
export { KnowledgeService } from "./knowledge";
