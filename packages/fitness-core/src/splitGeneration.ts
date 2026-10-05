import type {
  EquipmentId,
  MuscleId,
  SessionTemplate,
  TrainingExperience,
  UserId,
} from "@fitcoach/domain";
import { NotImplementedError } from "./errors";

export interface SplitGenerationRequest {
  userId: UserId;
  daysPerWeek: number;
  sessionDurationMinutes: number;
  experienceLevel: TrainingExperience;
  availableEquipmentIds: readonly EquipmentId[];
  priorityMuscleIds?: readonly MuscleId[];
}

export interface SplitProposal {
  sessionsPerWeek: number;
  sessionTemplates: readonly SessionTemplate[];
  rationaleNotes: readonly string[];
}

/**
 * Generate a weekly split proposal from the user's constraints. Output is a
 * candidate structure only; turning it into a persisted TrainingPlan (with
 * ids and status) is the application layer's job.
 */
export function generateSplit(_request: SplitGenerationRequest): SplitProposal {
  throw new NotImplementedError("splitGeneration.generateSplit");
}
