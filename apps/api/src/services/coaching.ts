import type {
  CreateDiagnosisInput,
  CreateInterventionInput,
  CreateRecommendationInput,
  DiagnosisRecord,
  EvidenceInput,
  InterventionRecord,
  RecommendationRecord,
  RecordOutcomeInput,
  Repositories,
} from "@fitcoach/db";
import type {
  CalendarDate,
  DiagnosisStatus,
  InterventionKind,
  InterventionParameters,
  InterventionStatus,
  OutcomeVerdict,
  RecommendationStatus,
  Severity,
  Timestamp,
} from "@fitcoach/domain";
import { NotFoundError } from "@fitcoach/db";

/**
 * Coaching service — the adaptive loop's write path.
 *
 * Context rules (milestone §5/§12):
 *   * a diagnosis records the goal and plan version that were ACTIVE when it
 *     was made (resolved automatically when not supplied);
 *   * a recommendation copies its evidence verbatim (as presented);
 *   * 'no_change' is a first-class intervention, created like any other.
 */

export interface CreateDiagnosisCommand {
  id?: string;
  activeGoalId?: string;
  activePlanVersionId?: string;
  code: string;
  title: string;
  summary: string;
  severity: Severity;
  status?: DiagnosisStatus;
  analysisWindowDays?: number;
  contextSnapshot?: Record<string, unknown>;
  contributingFactors?: string[];
  ruledOut?: string[];
  evidence?: EvidenceInput[];
}

export interface CreateRecommendationCommand {
  id?: string;
  diagnosisId?: string;
  interventionId?: string;
  headline: string;
  explanation: string;
  evidence?: EvidenceInput[];
  alternativesConsidered?: string[];
  presentedAt?: Timestamp;
  status?: RecommendationStatus;
}

export interface CreateInterventionCommand {
  id?: string;
  diagnosisId?: string;
  activeGoalId?: string;
  activePlanVersionId?: string;
  kind: InterventionKind;
  parameters?: InterventionParameters;
  rationale: string;
  expectedEffect: string;
  reviewOn?: CalendarDate;
  status?: InterventionStatus;
}

export interface RecordOutcomeCommand {
  id?: string;
  evaluatedAt?: Timestamp;
  evaluationWindow: string;
  verdict: OutcomeVerdict;
  observations?: string[];
  explanation: string;
  followUpDiagnosisId?: string;
}

export class CoachingService {
  constructor(private readonly repos: Repositories) {}

  private async requireUser(userId: string): Promise<{ timezone: string }> {
    const user = await this.repos.users.findById(userId);
    if (!user) throw new NotFoundError(`user ${userId} not found`);
    return user;
  }

  /**
   * The decision-time context: active goal + latest active plan version.
   * Explicit command values win; otherwise the current state is captured.
   */
  private async resolveContext(userId: string): Promise<{
    activeGoalId?: string;
    activePlanVersionId?: string;
  }> {
    const activeGoal = await this.repos.goals.active(userId);
    const activePlan = await this.repos.trainingPlans.findActive(userId);
    const latestVersion = activePlan?.versions[activePlan.versions.length - 1];
    return {
      ...(activeGoal ? { activeGoalId: activeGoal.id } : {}),
      ...(latestVersion ? { activePlanVersionId: latestVersion.id } : {}),
    };
  }

  async createDiagnosis(userId: string, command: CreateDiagnosisCommand): Promise<DiagnosisRecord> {
    await this.requireUser(userId);
    const context = await this.resolveContext(userId);
    const input: CreateDiagnosisInput = {
      ...(command.id ? { id: command.id } : {}),
      userId,
      activeGoalId: command.activeGoalId ?? context.activeGoalId,
      activePlanVersionId: command.activePlanVersionId ?? context.activePlanVersionId,
      code: command.code,
      title: command.title,
      summary: command.summary,
      severity: command.severity,
      ...(command.status ? { status: command.status } : {}),
      ...(command.analysisWindowDays !== undefined
        ? { analysisWindowDays: command.analysisWindowDays }
        : {}),
      ...(command.contextSnapshot ? { contextSnapshot: command.contextSnapshot } : {}),
      ...(command.contributingFactors ? { contributingFactors: command.contributingFactors } : {}),
      ...(command.ruledOut ? { ruledOut: command.ruledOut } : {}),
      ...(command.evidence ? { evidence: command.evidence } : {}),
    };
    return this.repos.diagnoses.create(input);
  }

  async attachEvidence(diagnosisId: string, evidence: EvidenceInput[]): Promise<DiagnosisRecord> {
    return this.repos.diagnoses.attachEvidence(diagnosisId, evidence);
  }

  updateDiagnosisStatus(
    id: string,
    status: DiagnosisStatus,
    resolvedAt?: Timestamp,
  ): Promise<DiagnosisRecord> {
    return this.repos.diagnoses.updateStatus(id, status, resolvedAt);
  }

  async listDiagnoses(userId: string, options: { status?: DiagnosisStatus; limit?: number }) {
    await this.requireUser(userId);
    return this.repos.diagnoses.list(userId, options);
  }

  async createRecommendation(
    userId: string,
    command: CreateRecommendationCommand,
  ): Promise<RecommendationRecord> {
    await this.requireUser(userId);

    let evidence = command.evidence;
    if (!evidence && command.diagnosisId) {
      // Default: present the diagnosis's findings as they stand right now.
      const diagnosis = await this.repos.diagnoses.findById(command.diagnosisId);
      if (!diagnosis || diagnosis.userId !== userId) {
        throw new NotFoundError(`diagnosis ${command.diagnosisId} not found`);
      }
      evidence = diagnosis.evidence.map((item) => ({
        metric: item.metric,
        window: item.window,
        observed: item.observed,
        ...(item.observedNumeric !== undefined ? { observedNumeric: item.observedNumeric } : {}),
        ...(item.expected !== undefined ? { expected: item.expected } : {}),
      }));
    }

    const input: CreateRecommendationInput = {
      ...(command.id ? { id: command.id } : {}),
      userId,
      ...(command.diagnosisId ? { diagnosisId: command.diagnosisId } : {}),
      ...(command.interventionId ? { interventionId: command.interventionId } : {}),
      headline: command.headline,
      explanation: command.explanation,
      ...(evidence ? { evidence } : {}),
      ...(command.alternativesConsidered
        ? { alternativesConsidered: command.alternativesConsidered }
        : {}),
      ...(command.presentedAt ? { presentedAt: command.presentedAt } : {}),
      ...(command.status ? { status: command.status } : {}),
    };
    return this.repos.recommendations.create(input);
  }

  async listRecommendations(userId: string, options: { limit?: number }) {
    await this.requireUser(userId);
    return this.repos.recommendations.list(userId, options);
  }

  async createIntervention(
    userId: string,
    command: CreateInterventionCommand,
  ): Promise<InterventionRecord> {
    await this.requireUser(userId);
    const context = await this.resolveContext(userId);
    const input: CreateInterventionInput = {
      ...(command.id ? { id: command.id } : {}),
      userId,
      ...(command.diagnosisId ? { diagnosisId: command.diagnosisId } : {}),
      activeGoalId: command.activeGoalId ?? context.activeGoalId,
      activePlanVersionId: command.activePlanVersionId ?? context.activePlanVersionId,
      kind: command.kind,
      ...(command.parameters ? { parameters: command.parameters } : {}),
      rationale: command.rationale,
      expectedEffect: command.expectedEffect,
      ...(command.reviewOn ? { reviewOn: command.reviewOn } : {}),
      ...(command.status ? { status: command.status } : {}),
    };
    return this.repos.interventions.create(input);
  }

  async listInterventions(userId: string, options: { status?: InterventionStatus; limit?: number }) {
    await this.requireUser(userId);
    return this.repos.interventions.list(userId, options);
  }

  async recordOutcome(
    userId: string,
    interventionId: string,
    command: RecordOutcomeCommand,
  ) {
    const intervention = await this.repos.interventions.findById(interventionId);
    if (!intervention || intervention.userId !== userId) {
      throw new NotFoundError(`intervention ${interventionId} not found`);
    }
    const input: RecordOutcomeInput = {
      ...(command.id ? { id: command.id } : {}),
      interventionId,
      ...(command.evaluatedAt ? { evaluatedAt: command.evaluatedAt } : {}),
      evaluationWindow: command.evaluationWindow,
      verdict: command.verdict,
      ...(command.observations ? { observations: command.observations } : {}),
      explanation: command.explanation,
      ...(command.followUpDiagnosisId ? { followUpDiagnosisId: command.followUpDiagnosisId } : {}),
    };
    return this.repos.interventions.recordOutcome(input);
  }

  listOutcomes(interventionId: string) {
    return this.repos.interventions.outcomes(interventionId);
  }
}
