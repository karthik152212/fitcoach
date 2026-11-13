import type { Repositories } from "@fitcoach/db";
import type { BodyMeasurementRepository } from "@fitcoach/db";
import type { ProfileRepository } from "@fitcoach/db";
import type { PhysiqueGoalRepository } from "@fitcoach/db";
import type { TrainingService } from "./training";
import type { RecoveryState } from "@fitcoach/domain";
import type { PlanVersionRecord } from "@fitcoach/db";

import {
  analyzeBodyMeasurements,
  type FullMeasurementAnalysis,
  assessMuscleDevelopment,
  getMuscleDevelopmentGaps,
  getMuscleDevelopmentHighlights,
  type PhysiqueGoal,
  type PhysiqueGoalInput,
  type PhysiquePriorityTag,
  defaultPhysiqueGoalForTrainingGoal,
  buildBodyAssessment,
  type DisproportionateAssessmentInput,
  generateBodyRecommendations,
  type BodyRecommendation,
  buildBodyContextForIntegration,
  type BodyContextForIntegration,
  type BodyAssessment,
} from "@fitcoach/fitness-core";
import type { MuscleCoverageReport } from "@fitcoach/fitness-core";
import type { WeeklyVolumeReport } from "@fitcoach/domain";
import type { TrainingExperience } from "@fitcoach/domain";
import type { BodyMeasurement } from "@fitcoach/domain";

/**
 * Body Intelligence Service
 *
 * Orchestrates body measurements analysis, physique goals, muscle development
 * assessment, disproportionate development detection, and cross-engine integration.
 * All deterministic computation lives in packages/fitness-core/body.
 */

export interface PhysiqueGoalService {
  create(userId: string, input: PhysiqueGoalInput): Promise<PhysiqueGoal>;
  get(userId: string): Promise<PhysiqueGoal | null>;
  update(userId: string, updates: Partial<PhysiqueGoalInput>): Promise<PhysiqueGoal>;
  delete(userId: string): Promise<void>;
  getDefaultForTrainingGoal(userId: string, trainingGoalKind: string): PhysiqueGoal;
  history(userId: string, limit?: number): Promise<PhysiqueGoal[]>;
}

export interface BodyIntelligenceService {
  // Full assessment
  getBodyAssessment(userId: string, asOf?: string): Promise<BodyAssessmentResponse>;

  // Components
  getMeasurementAnalysis(userId: string, heightCm: number, sex: "male" | "female"): Promise<FullMeasurementAnalysis>;
  getMuscleDevelopmentAnalysis(userId: string): Promise<MuscleDevelopmentResponse>;
  getDisproportionateAnalysis(userId: string): Promise<DisproportionateResponse>;

  // Physique goals
  createPhysiqueGoal(userId: string, input: PhysiqueGoalInput): Promise<PhysiqueGoal>;
  getPhysiqueGoal(userId: string): Promise<PhysiqueGoal | null>;
  updatePhysiqueGoal(userId: string, updates: Partial<PhysiqueGoalInput>): Promise<PhysiqueGoal>;
  deletePhysiqueGoal(userId: string): Promise<void>;
  getDefaultPhysiqueGoal(userId: string, trainingGoalKind: string): PhysiqueGoal;

  // Recommendations
  getBodyRecommendations(userId: string): Promise<BodyRecommendation[]>;

  // Cross-engine context
  getBodyContextForIntegration(userId: string): Promise<BodyContextForIntegration>;
}

export interface BodyAssessmentResponse {
  userId: string;
  asOf: string;
  weightTrend: FullMeasurementAnalysis["weightTrend"];
  circumferenceTrends: FullMeasurementAnalysis["circumferenceTrends"];
  composition: FullMeasurementAnalysis["composition"];
  completeness: FullMeasurementAnalysis["completeness"];
  muscleDevelopment: MuscleDevelopmentResponse["muscleDevelopment"];
  disproportionateDevelopment: DisproportionateResponse["disproportionateDevelopment"];
  goalRelativeProgress: "on_track" | "needs_attention" | "insufficient_data";
  priorityActions: readonly string[];
}

export interface MuscleDevelopmentResponse {
  muscleDevelopment: Array<{
    muscle: string;
    trainingExposureScore: number;
    measurementTrend?: "increasing" | "decreasing" | "stable" | "insufficient_data";
    measurementSlopePerWeek?: number | null;
    measurementConfidence?: number | null;
    recoveryContext: "supportive" | "neutral" | "limiting";
    volumeAppropriateness: "insufficient" | "appropriate" | "excessive" | "unknown";
    developmentStatus: "progressing" | "maintaining" | "regressing" | "insufficient_data";
    confidence: number;
    evidence: readonly string[];
  }>;
  gaps: readonly string[];
  highlights: readonly string[];
}

export interface DisproportionateResponse {
  disproportionateDevelopment: Array<{
    ruleId: string;
    ruleVersion: number;
    priorityTag: string;
    type: "lagging" | "dominant" | "asymmetric" | "proportion_deviation";
    involvedMuscles: readonly string[];
    severity: number;
    confidence: number;
    observationWeeks: number;
    observation: string;
    evidence: readonly string[];
    recommendedIntervention: "collect_more_data" | "adjust_nutrition" | "review_training" | "reassess_technique" | "maintain" | "no_change";
    basisNote: string;
  }>;
}

export class BodyIntelligenceServiceImpl implements BodyIntelligenceService {
  constructor(
    private readonly bodyMeasurements: BodyMeasurementRepository,
    private readonly profiles: ProfileRepository,
    private readonly physiqueGoals: PhysiqueGoalRepository,
    private readonly training: TrainingService,
  ) {}

  // ---------------------------------------------------------------------------
  // Full assessment
  // ---------------------------------------------------------------------------

  async getBodyAssessment(userId: string, asOf?: string): Promise<BodyAssessmentResponse> {
    // Get profile for height/sex
    const profile = await this.profiles.get(userId);
    if (!profile || !profile.heightCm || !profile.sex) {
      throw new Error("Profile with height and sex required for body assessment");
    }

    // Get measurements
    const measurements = await this.bodyMeasurements.history(userId, { limit: 500 });
    if (measurements.length === 0) {
      throw new Error("No body measurements found");
    }

    // Get muscle coverage report from active training plan
    const coverageReport = await this.getMuscleCoverageReport(userId);

    // Get volume report
    const volumeReport = await this.getVolumeReport(userId);

    // Get recovery state
    const recoveryState = await this.getRecoveryState(userId);

    // Get physique goal
    const physiqueGoal = await this.getPhysiqueGoal(userId);

    // Run full measurement analysis
    const measurementAnalysis = analyzeBodyMeasurements(
      measurements as unknown as readonly BodyMeasurement[],
      profile.heightCm,
      profile.sex as "male" | "female",
    );

    // Assess muscle development
    const experienceMap: Record<TrainingExperience, "novice" | "intermediate" | "advanced"> = {
      untrained: "novice",
      beginner: "novice",
      intermediate: "intermediate",
      advanced: "advanced",
    };
    const muscleDevelopment = assessMuscleDevelopment({
      coverageReport,
      volumeReport,
      circumferenceTrends: measurementAnalysis.circumferenceTrends.map((t) => ({
        site: t.site,
        direction: t.direction,
        slopeCmPerWeek: t.slopeCmPerWeek,
        confidence: t.confidence,
      })),
      recoveryState,
      physiqueGoalPriorities: physiqueGoal?.priorities ?? [],
      experience: experienceMap[profile.trainingExperience ?? "beginner"],
      goalProfile: physiqueGoal?.direction ?? "recomp",
    });

    // Build disproportionate assessment input
    const disproportionateInput: DisproportionateAssessmentInput = {
      asOf: (asOf ?? new Date().toISOString().split("T")[0]) as any,
      weightTrend: measurementAnalysis.weightTrend,
      circumferenceTrends: measurementAnalysis.circumferenceTrends,
      composition: measurementAnalysis.composition,
      completeness: measurementAnalysis.completeness,
      muscleDevelopment,
      physiqueGoal: physiqueGoal ? { priorities: physiqueGoal.priorities } : null,
    };

    // Get disproportionate development from assessment module
    const bodyAssessment = buildBodyAssessment(userId, disproportionateInput, []);

    // Get recommendations
    generateBodyRecommendations({
      assessment: bodyAssessment,
      physiqueGoal: physiqueGoal ? { priorities: physiqueGoal.priorities, direction: physiqueGoal.direction } : null,
      asOf: bodyAssessment.asOf,
    });

    return {
      userId,
      asOf: bodyAssessment.asOf,
      weightTrend: bodyAssessment.weightTrend,
      circumferenceTrends: bodyAssessment.circumferenceTrends,
      composition: bodyAssessment.composition,
      completeness: bodyAssessment.completeness,
      muscleDevelopment: bodyAssessment.muscleDevelopment.map((m) => ({
        muscle: m.muscle,
        trainingExposureScore: m.trainingExposureScore,
        measurementTrend: m.measurementTrend,
        measurementSlopePerWeek: m.measurementSlopePerWeek,
        measurementConfidence: m.measurementConfidence,
        recoveryContext: m.recoveryContext,
        volumeAppropriateness: m.volumeAppropriateness,
        developmentStatus: m.developmentStatus,
        confidence: m.confidence,
        evidence: m.evidence,
      })),
      disproportionateDevelopment: bodyAssessment.disproportionateDevelopment.map((d) => ({
        ruleId: d.ruleId,
        ruleVersion: d.ruleVersion,
        priorityTag: d.priorityTag,
        type: d.type,
        involvedMuscles: d.involvedMuscles,
        severity: d.severity,
        confidence: d.confidence,
        observationWeeks: d.observationWeeks,
        observation: d.observation,
        evidence: d.evidence,
        recommendedIntervention: d.recommendedIntervention,
        basisNote: d.basisNote,
      })),
      goalRelativeProgress: bodyAssessment.goalRelativeProgress,
      priorityActions: bodyAssessment.priorityActions,
    };
  }

  async getMeasurementAnalysis(
    userId: string,
    heightCm: number,
    sex: "male" | "female",
  ): Promise<FullMeasurementAnalysis> {
    const measurements = await this.bodyMeasurements.history(userId, { limit: 500 });
    if (measurements.length === 0) {
      throw new Error("No body measurements found");
    }
    return analyzeBodyMeasurements(measurements as unknown as readonly BodyMeasurement[], heightCm, sex);
  }

  async getMuscleDevelopmentAnalysis(userId: string): Promise<MuscleDevelopmentResponse> {
    const profile = await this.profiles.get(userId);
    if (!profile || !profile.heightCm || !profile.sex) {
      throw new Error("Profile with height and sex required");
    }

    const measurements = await this.bodyMeasurements.history(userId, { limit: 500 });
    if (measurements.length === 0) {
      throw new Error("No body measurements found");
    }

    const measurementAnalysis = analyzeBodyMeasurements(
      measurements as unknown as readonly BodyMeasurement[],
      profile.heightCm,
      profile.sex as "male" | "female",
    );

    const coverageReport = await this.getMuscleCoverageReport(userId);
    const volumeReport = await this.getVolumeReport(userId);
    const recoveryState = await this.getRecoveryState(userId);
    const physiqueGoal = await this.getPhysiqueGoal(userId);

    const experienceMap: Record<TrainingExperience, "novice" | "intermediate" | "advanced"> = {
      untrained: "novice",
      beginner: "novice",
      intermediate: "intermediate",
      advanced: "advanced",
    };

    const muscleDevelopment = assessMuscleDevelopment({
      coverageReport,
      volumeReport,
      circumferenceTrends: measurementAnalysis.circumferenceTrends.map((t) => ({
        site: t.site,
        direction: t.direction,
        slopeCmPerWeek: t.slopeCmPerWeek,
        confidence: t.confidence,
      })),
      recoveryState,
      physiqueGoalPriorities: physiqueGoal?.priorities ?? [],
      experience: experienceMap[profile.trainingExperience ?? "beginner"],
      goalProfile: physiqueGoal?.direction ?? "recomp",
    });

    const gaps = getMuscleDevelopmentGaps(muscleDevelopment, physiqueGoal?.priorities ?? []);
    const highlights = getMuscleDevelopmentHighlights(muscleDevelopment);

    return {
      muscleDevelopment: muscleDevelopment.map((m) => ({
        muscle: m.muscle,
        trainingExposureScore: m.trainingExposureScore,
        measurementTrend: m.measurementTrend,
        measurementSlopePerWeek: m.measurementSlopePerWeek,
        measurementConfidence: m.measurementConfidence,
        recoveryContext: m.recoveryContext,
        volumeAppropriateness: m.volumeAppropriateness,
        developmentStatus: m.developmentStatus,
        confidence: m.confidence,
        evidence: m.evidence,
      })),
      gaps,
      highlights,
    };
  }

  async getDisproportionateAnalysis(userId: string): Promise<DisproportionateResponse> {
    const profile = await this.profiles.get(userId);
    if (!profile || !profile.heightCm || !profile.sex) {
      throw new Error("Profile with height and sex required");
    }

    const measurements = await this.bodyMeasurements.history(userId, { limit: 500 });
    if (measurements.length === 0) {
      throw new Error("No body measurements found");
    }

    const measurementAnalysis = analyzeBodyMeasurements(
      measurements as unknown as readonly BodyMeasurement[],
      profile.heightCm,
      profile.sex as "male" | "female",
    );

    const coverageReport = await this.getMuscleCoverageReport(userId);
    const volumeReport = await this.getVolumeReport(userId);
    const recoveryState = await this.getRecoveryState(userId);
    const physiqueGoal = await this.getPhysiqueGoal(userId);

    const experienceMap: Record<TrainingExperience, "novice" | "intermediate" | "advanced"> = {
      untrained: "novice",
      beginner: "novice",
      intermediate: "intermediate",
      advanced: "advanced",
    };

    const muscleDevelopment = assessMuscleDevelopment({
      coverageReport,
      volumeReport,
      circumferenceTrends: measurementAnalysis.circumferenceTrends.map((t) => ({
        site: t.site,
        direction: t.direction,
        slopeCmPerWeek: t.slopeCmPerWeek,
        confidence: t.confidence,
      })),
      recoveryState,
      physiqueGoalPriorities: physiqueGoal?.priorities ?? [],
      experience: experienceMap[profile.trainingExperience ?? "beginner"],
      goalProfile: physiqueGoal?.direction ?? "recomp",
    });

    const disproportionateInput: DisproportionateAssessmentInput = {
      asOf: new Date().toISOString().split("T")[0] as any,
      weightTrend: measurementAnalysis.weightTrend,
      circumferenceTrends: measurementAnalysis.circumferenceTrends,
      composition: measurementAnalysis.composition,
      completeness: measurementAnalysis.completeness,
      muscleDevelopment,
      physiqueGoal: physiqueGoal ? { priorities: physiqueGoal.priorities } : null,
    };

    const bodyAssessment = buildBodyAssessment(userId, disproportionateInput, []);

    return {
      disproportionateDevelopment: bodyAssessment.disproportionateDevelopment.map((d) => ({
        ruleId: d.ruleId,
        ruleVersion: d.ruleVersion,
        priorityTag: d.priorityTag,
        type: d.type,
        involvedMuscles: d.involvedMuscles,
        severity: d.severity,
        confidence: d.confidence,
        observationWeeks: d.observationWeeks,
        observation: d.observation,
        evidence: d.evidence,
        recommendedIntervention: d.recommendedIntervention,
        basisNote: d.basisNote,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Physique goals
  // ---------------------------------------------------------------------------

  async createPhysiqueGoal(userId: string, input: PhysiqueGoalInput): Promise<PhysiqueGoal> {
    const record = await this.physiqueGoals.create({
      userId: userId as any,
      priorities: input.priorities.map(p => ({ tag: p, label: p })),
      customPriorities: input.customPriorities?.map(p => ({ tag: p.tag, label: p.label })),
      targetTimeframeWeeks: input.targetTimeframeWeeks,
      direction: input.direction,
    });
    return this.convertToPhysiqueGoal(record);
  }

  async getPhysiqueGoal(userId: string): Promise<PhysiqueGoal | null> {
    const goal = await this.physiqueGoals.getActive(userId as any);
    if (!goal) return null;
    return this.convertToPhysiqueGoal(goal);
  }

  async updatePhysiqueGoal(userId: string, updates: Partial<PhysiqueGoalInput>): Promise<PhysiqueGoal> {
    const updateInput: any = {};
    if (updates.priorities) updateInput.priorities = updates.priorities.map(p => ({ tag: p, label: p }));
    if (updates.customPriorities) updateInput.customPriorities = updates.customPriorities.map(p => ({ tag: p.tag, label: p.label }));
    if (updates.targetTimeframeWeeks !== undefined) updateInput.targetTimeframeWeeks = updates.targetTimeframeWeeks;
    if (updates.direction) updateInput.direction = updates.direction;

    const goal = await this.physiqueGoals.update(userId as any, updateInput);
    return this.convertToPhysiqueGoal(goal);
  }

  async deletePhysiqueGoal(userId: string): Promise<void> {
    await this.physiqueGoals.delete(userId as any);
  }

  async getPhysiqueGoalHistory(userId: string, limit?: number): Promise<PhysiqueGoal[]> {
    const goals = await this.physiqueGoals.history(userId as any, limit);
    return goals.map(goal => this.convertToPhysiqueGoal(goal));
  }

  private convertToPhysiqueGoal(record: import("@fitcoach/db").PhysiqueGoalRecord): PhysiqueGoal {
    return {
      id: record.id,
      userId: record.userId,
      priorities: record.priorities.map(p => p.tag) as PhysiquePriorityTag[],
      customPriorities: record.customPriorities?.map(p => ({ tag: p.tag, label: p.label })),
      targetTimeframeWeeks: record.targetTimeframeWeeks,
      direction: record.direction,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  getDefaultPhysiqueGoal(userId: string, trainingGoalKind: string): PhysiqueGoal {
    return defaultPhysiqueGoalForTrainingGoal(userId, trainingGoalKind);
  }

  // ---------------------------------------------------------------------------
  // Recommendations
  // ---------------------------------------------------------------------------

  async getBodyRecommendations(userId: string): Promise<BodyRecommendation[]> {
    const assessment = await this.getBodyAssessment(userId);
    const physiqueGoal = await this.getPhysiqueGoal(userId);

    // Convert BodyAssessmentResponse to BodyAssessment
    const bodyAssessment: BodyAssessment = {
      userId: assessment.userId,
      asOf: assessment.asOf as any,
      weightTrend: assessment.weightTrend,
      circumferenceTrends: assessment.circumferenceTrends as any,
      composition: assessment.composition,
      completeness: assessment.completeness,
      muscleDevelopment: assessment.muscleDevelopment as any,
      disproportionateDevelopment: assessment.disproportionateDevelopment as any,
      goalRelativeProgress: assessment.goalRelativeProgress,
      priorityActions: assessment.priorityActions,
    };

    const recommendations = generateBodyRecommendations({
      assessment: bodyAssessment,
      physiqueGoal: physiqueGoal ? { priorities: physiqueGoal.priorities, direction: physiqueGoal.direction } : null,
      asOf: assessment.asOf as any,
    });
    return recommendations as BodyRecommendation[];
  }

  // ---------------------------------------------------------------------------
  // Cross-engine context
  // ---------------------------------------------------------------------------

  async getBodyContextForIntegration(userId: string): Promise<BodyContextForIntegration> {
    const assessment = await this.getBodyAssessment(userId);
    return buildBodyContextForIntegration(assessment as any);
  }

  // ---------------------------------------------------------------------------
  // Helpers to fetch data from other engines
  // ---------------------------------------------------------------------------

  private async getMuscleCoverageReport(userId: string): Promise<MuscleCoverageReport> {
    // Get active training plan
    const activePlan = await this.training.getActivePlan(userId);
    if (!activePlan) {
      // Return empty coverage report
      return {
        perMuscle: [],
        musclesWithoutDirectWork: [],
      };
    }

    // Get exercise IDs from the plan (latest version)
    const latestVersion = activePlan.versions[activePlan.versions.length - 1];
    if (latestVersion) {
      latestVersion.sessions.flatMap((s: PlanVersionRecord["sessions"][0]) =>
        s.slots.map((slot) => slot.exerciseId)
      );
    }

    // Get user's equipment
    // This would call the knowledge service's muscleCoverage function
    // For now return a minimal report
    return {
      perMuscle: [],
      musclesWithoutDirectWork: [],
    };
  }

  private async getVolumeReport(_userId: string): Promise<WeeklyVolumeReport> {
    // Get volume report from training planner service
    // For now return a minimal report
    return {
      byMuscle: [],
      totalPlannedSets: 0,
      totalEffectiveSets: 0,
      underTargetMuscles: [],
      potentiallyExcessiveMuscles: [],
      redundantExposure: [],
    };
  }

  private async getRecoveryState(_userId: string): Promise<RecoveryState | undefined> {
    // This would call the recovery intelligence service
    // For now return undefined
    return undefined;
  }
}

export function createBodyIntelligenceService(
  repos: Pick<
    Repositories,
    | "bodyMeasurements"
    | "profiles"
    | "physiqueGoals"
  >,
  training: TrainingService,
): BodyIntelligenceService {
  return new BodyIntelligenceServiceImpl(
    repos.bodyMeasurements,
    repos.profiles,
    repos.physiqueGoals,
    training,
  );
}