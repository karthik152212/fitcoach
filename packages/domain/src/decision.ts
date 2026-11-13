import type {
  BaseEntity,
  CalendarDate,
  ConfidenceLevel,
  DiagnosisId,
  DecisionEvidenceId,
  DecisionSnapshotId,
  EntityId,
  InterventionId,
  ProvenanceClass,
  Timestamp,
  UnifiedStateId,
  UserId,
} from "./shared";
import type { Goal } from "./goal";

/**
 * Unified Decision Brain — Phase 8
 *
 * This module defines the types for the unified decision layer that connects
 * all specialist engines (training, nutrition, activity, recovery, body, projection)
 * into one coherent, evidence-driven coaching decision system.
 */

// ---------------------------------------------------------------------------
// Unified FitCoach State — versioned representation combining all specialist evidence
// ---------------------------------------------------------------------------

/**
 * The kind of evidence source in the unified state.
 */
export type UnifiedStateSourceKind =
  | "training_state"
  | "nutrition_state"
  | "activity_state"
  | "recovery_state"
  | "body_state"
  | "projection_state"
  | "goal_state";

/**
 * A slice of specialist state included in the unified state.
 */
export interface UnifiedStateSlice {
  /** Which specialist produced this slice. */
  sourceKind: UnifiedStateSourceKind;
  /** Configuration version of the specialist engine at snapshot time. */
  configVersion: string;
  /** When this slice was computed. */
  computedAt: Timestamp;
  /** Serialized specialist state (engine-specific). */
  payload: unknown;
  /** Confidence in this slice's accuracy. */
  confidence: ConfidenceLevel;
  /** Warnings about reliability of this slice. */
  warnings: readonly string[];
}

/**
 * The complete Unified FitCoach State — a versioned, immutable snapshot
 * combining evidence from all specialist engines at a point in time.
 * Recalculating produces a new snapshot rather than mutating the old one.
 */
export interface UnifiedFitCoachState extends BaseEntity {
  /** Unique identifier for this unified state snapshot. */
  id: UnifiedStateId;
  /** User this state is for. */
  userId: UserId;
  /** The day this unified state was generated (user-local). */
  generatedAt: CalendarDate;
  /** Version of the unified decision engine config. */
  configVersion: string;
  /** All specialist state slices. */
  slices: readonly UnifiedStateSlice[];
  /** Active goal at generation time (serialized). */
  activeGoal?: Goal;
  /** Active interventions at generation time (serialized). */
  activeInterventions: readonly string[];
  /** Whether this state supersedes a previous one. */
  supersedesId?: UnifiedStateId;
  /** Human-readable summary for UI. */
  summary: string;
  /** Cross-cutting warnings (e.g., "low measurement frequency across domains"). */
  warnings: readonly string[];
}

/**
 * Request to build a unified state snapshot.
 */
export interface BuildUnifiedStateRequest {
  userId: UserId;
  /** The day to anchor the state. Defaults to today. */
  asOf?: CalendarDate;
  /** Specific slices to include. Defaults to all available. */
  includeSlices?: UnifiedStateSourceKind[];
  /** Override specific specialist configs. */
  configOverrides?: Partial<Record<UnifiedStateSourceKind, string>>;
}

// ---------------------------------------------------------------------------
// Decision Assumptions — explicit, versioned, sensitive-flagged
// ---------------------------------------------------------------------------

/**
 * Category of assumption in the decision brain.
 */
export type DecisionAssumptionCategory =
  | "adherence"
  | "nutrition"
  | "training"
  | "recovery"
  | "progression_rate"
  | "body_composition"
  | "measurement_consistency"
  | "external_factor"
  | "goal_feasibility"
  | "intervention_durability";

/**
 * A single assumption underlying a unified decision.
 * Mirrors ProjectionAssumption but scoped to decision-making.
 */
export interface DecisionAssumption {
  /** Stable machine code, e.g. "training_adherence_85_percent". */
  code: string;
  /** Human-readable description. */
  description: string;
  /** Category for grouping in UI. */
  category: DecisionAssumptionCategory;
  /** The assumed value (serialized). */
  value: string;
  /** Whether changing this assumption would significantly change the decision. */
  sensitive: boolean;
  /** Source of this assumption (e.g., "projection", "configuration", "manual_override"). */
  source: string;
}

// ---------------------------------------------------------------------------
// Decision Evidence — citations to deterministic findings
// ---------------------------------------------------------------------------

/**
 * Kind of evidence cited by a decision.
 */
export type DecisionEvidenceKind =
  | "diagnosis"
  | "projection_divergence"
  | "plateau_signal"
  | "disproportionate_development"
  | "nutrition_adherence"
  | "recovery_state"
  | "goal_alignment"
  | "plan_quality"
  | "environment_constraint"
  | "trend"
  | "custom";

/**
 * A piece of evidence cited by a decision.
 * Links back to the deterministic engine output that produced it.
 */
export interface DecisionEvidence extends BaseEntity {
  /** Unique identifier for this evidence record. */
  id: DecisionEvidenceId;
  /** User this evidence pertains to. */
  userId: UserId;
  /** What kind of evidence this is. */
  kind: DecisionEvidenceKind;
  /** Stable machine code for the finding, e.g. "protein_intake_below_target". */
  code: string;
  /** Human-readable description of the finding. */
  description: string;
  /** Engine that produced this evidence. */
  engine: UnifiedStateSourceKind;
  /** Configuration version of the engine at evidence time. */
  engineConfigVersion: string;
  /** When the evidence was generated. */
  generatedAt: Timestamp;
  /** Serialized evidence payload (engine-specific). */
  payload: unknown;
  /** Confidence in this evidence. */
  confidence: ConfidenceLevel;
  /** Provenance of the underlying observations. */
  provenance: ProvenanceClass;
  /** Whether this evidence is sensitive (changing it would change decisions). */
  sensitive: boolean;
  /** Related entity IDs for traceability. */
  relatedEntityIds: readonly EntityId[];
  /** Human-readable basis for explainability. */
  basis: string;
}

/**
 * Request to record decision evidence.
 */
export interface RecordDecisionEvidenceRequest {
  userId: UserId;
  evidence: Omit<DecisionEvidence, "id" | "createdAt" | "updatedAt">[];
}

// ---------------------------------------------------------------------------
// Unified Diagnosis — cross-engine problem identification
// ---------------------------------------------------------------------------

/**
 * Severity of a diagnosis in the unified context.
 * Extends the base severity with cross-engine consideration.
 */
export type UnifiedSeverity = "informational" | "watch" | "act" | "urgent";

/**
 * A unified diagnosis that may draw evidence from multiple engines.
 */
export interface UnifiedDiagnosis extends BaseEntity {
  /** Unique identifier. */
  id: DiagnosisId;
  /** User this diagnosis is for. */
  userId: UserId;
  /** Stable machine code, e.g. "protein_intake_below_target". */
  code: string;
  /** Human-readable title. */
  title: string;
  /** Detailed summary. */
  summary: string;
  /** Severity considering cross-engine impact. */
  severity: UnifiedSeverity;
  /** Evidence citations supporting this diagnosis. */
  evidence: readonly DecisionEvidence[];
  /** Contributing factors (engine codes). */
  contributingFactors: readonly string[];
  /** Ruled-out alternative explanations. */
  ruledOut: readonly string[];
  /** Which engines contributed evidence. */
  sourceEngines: readonly UnifiedStateSourceKind[];
  /** Status in the decision lifecycle. */
  status: "open" | "monitoring" | "resolved" | "dismissed";
  /** Unified state snapshot this diagnosis was derived from. */
  unifiedStateId: UnifiedStateId;
  /** When this diagnosis was first opened. */
  openedAt: Timestamp;
  /** When this diagnosis was last updated. */
  updatedAt: Timestamp;
  /** Optional review date. */
  reviewOn?: CalendarDate;
}

/**
 * Request to run unified diagnosis.
 */
export interface UnifiedDiagnosisRequest {
  userId: UserId;
  /** The unified state to diagnose. */
  unifiedState: UnifiedFitCoachState;
  /** Active diagnoses to re-evaluate (for monitoring). */
  activeDiagnoses?: readonly UnifiedDiagnosis[];
  /** Analysis window in days. */
  analysisWindowDays: number;
}

/**
 * Result of running unified diagnosis.
 */
export interface UnifiedDiagnosisResult {
  /** New diagnoses discovered. */
  newDiagnoses: readonly UnifiedDiagnosis[];
  /** Updated statuses for active diagnoses. */
  updatedDiagnoses: readonly UnifiedDiagnosis[];
  /** Diagnoses that are now resolved. */
  resolvedDiagnoses: readonly UnifiedDiagnosis[];
  /** Overall confidence in the diagnosis set. */
  confidence: ConfidenceLevel;
  /** Cross-engine warnings. */
  warnings: readonly string[];
}

// ---------------------------------------------------------------------------
// Intervention Selection — minimum effective intervention with specialist validation
// ---------------------------------------------------------------------------

/**
 * Priority rank for intervention selection (lower = higher priority).
 */
export type InterventionPrecedence =
  | "critical_safety"
  | "recovery_blocking"
  | "nutrition_foundation"
  | "training_progression"
  | "body_composition"
  | "activity_alignment"
  | "maintenance"
  | "optimization";

/**
 * Validation result from a specialist engine for a proposed intervention.
 */
export interface SpecialistValidation {
  /** Which specialist validated. */
  engine: UnifiedStateSourceKind;
  /** Whether the intervention is valid in this specialist's domain. */
  valid: boolean;
  /** Warnings or concerns from the specialist. */
  warnings: readonly string[];
  /** Conflicts with existing plans in this domain. */
  conflicts: readonly string[];
  /** Required adjustments for this specialist to accept. */
  requiredAdjustments: readonly string[];
  /** Confidence in this validation. */
  confidence: ConfidenceLevel;
}

/**
 * A candidate intervention with cross-engine validation.
 */
export interface ValidatedInterventionCandidate {
  /** The intervention kind. */
  kind: string;
  /** Intervention parameters. */
  parameters: Record<string, number | string | boolean | null>;
  /** Why this intervention was selected. */
  rationale: string;
  /** Expected effect description. */
  expectedEffect: string;
  /** Precedence rank (lower = try first). */
  precedence: InterventionPrecedence;
  /** Diagnoses this intervention addresses. */
  addressesDiagnoses: readonly DiagnosisId[];
  /** Cross-engine validations. */
  validations: readonly SpecialistValidation[];
  /** Overall validity (all critical specialists must be valid). */
  isValid: boolean;
  /** Confidence in this candidate. */
  confidence: ConfidenceLevel;
  /** Review date. */
  reviewOn?: CalendarDate;
}

/**
 * Context for intervention selection.
 */
export interface InterventionSelectionContext {
  /** Active goal. */
  goal?: Goal;
  /** Currently active interventions. */
  activeInterventions: readonly string[];
  /** Hard constraints that cannot be violated. */
  hardConstraints: readonly string[];
  /** Soft constraints with penalties. */
  softConstraints: readonly { constraint: string; penalty: number }[];
  /** User preferences affecting selection. */
  preferences?: Record<string, unknown>;
}

/**
 * Request to select interventions.
 */
export interface SelectInterventionsRequest {
  /** Diagnoses to address. */
  diagnoses: readonly UnifiedDiagnosis[];
  /** Selection context. */
  context: InterventionSelectionContext;
  /** Unified state for cross-engine awareness. */
  unifiedState: UnifiedFitCoachState;
  /** Maximum candidates to return. */
  maxCandidates?: number;
}

/**
 * Result of intervention selection.
 */
export interface SelectInterventionsResult {
  /** Validated candidates, ordered by precedence. */
  candidates: readonly ValidatedInterventionCandidate[];
  /** Diagnoses not addressed by any candidate. */
  unaddressedDiagnoses: readonly DiagnosisId[];
  /** Overall confidence. */
  confidence: ConfidenceLevel;
  /** Selection rationale summary. */
  rationale: string;
}

// ---------------------------------------------------------------------------
// Decision Snapshot — immutable decision record with supersession chain
// ---------------------------------------------------------------------------

/**
 * Status of a decision snapshot.
 */
export type DecisionSnapshotStatus = "current" | "superseded" | "archived" | "diverged";

/**
 * The kind of decision made.
 */
export type DecisionKind =
  | "intervention_selected"
  | "no_change"
  | "plan_adaptation"
  | "goal_adjustment"
  | "environment_adaptation"
  | "measurement_protocol_change"
  | "custom";

/**
 * A single intervention decision within a decision snapshot.
 */
export interface DecisionIntervention {
  /** The intervention ID (created when intervention is persisted). */
  interventionId?: InterventionId;
  /** The intervention kind. */
  kind: string;
  /** Parameters. */
  parameters: Record<string, number | string | boolean | null>;
  /** Rationale for this specific intervention. */
  rationale: string;
  /** Expected effect. */
  expectedEffect: string;
  /** Which diagnoses this addresses. */
  addressesDiagnoses: readonly DiagnosisId[];
  /** Review date. */
  reviewOn?: CalendarDate;
}

/**
 * An immutable decision snapshot — the output of the unified decision lifecycle.
 * Recalculating produces a new snapshot rather than mutating the old one.
 */
export interface DecisionSnapshot extends BaseEntity {
  /** Unique identifier. */
  id: DecisionSnapshotId;
  /** User this decision is for. */
  userId: UserId;
  /** The day this decision was made. */
  decidedAt: CalendarDate;
  /** Decision kind. */
  kind: DecisionKind;
  /** Status for lifecycle. */
  status: DecisionSnapshotStatus;
  /** Unified state this decision was based on. */
  unifiedStateId: UnifiedStateId;
  /** Diagnoses addressed by this decision. */
  diagnosesAddressed: readonly DiagnosisId[];
  /** Interventions decided. */
  interventions: readonly DecisionIntervention[];
  /** Assumptions underlying this decision. */
  assumptions: readonly DecisionAssumption[];
  /** Evidence citations. */
  evidence: readonly DecisionEvidence[];
  /** Monitoring plan (what to watch and when). */
  monitoringPlan: readonly string[];
  /** Configuration version used. */
  configVersion: string;
  /** Human-readable summary for UI. */
  summary: string;
  /** Confidence in this decision. */
  confidence: ConfidenceLevel;
  /** Optional: which snapshot this supersedes. */
  supersedesId?: DecisionSnapshotId;
  /** Warnings about reliability. */
  warnings: readonly string[];
}

/**
 * Request to generate a unified decision.
 */
export interface GenerateDecisionRequest {
  userId: UserId;
  /** The day to anchor the decision. Defaults to today. */
  asOf?: CalendarDate;
  /** Force re-evaluation even if current decision is recent. */
  forceReevaluate?: boolean;
  /** Override specific assumptions. */
  assumptionOverrides?: Partial<Record<DecisionAssumptionCategory, string>>;
}

/**
 * Result of generating a unified decision.
 */
export interface GenerateDecisionResult {
  /** The generated decision snapshot. */
  snapshot: DecisionSnapshot;
  /** Whether this is a new snapshot or an existing current one. */
  isNew: boolean;
  /** Previous current snapshot if superseded. */
  previousSnapshot?: DecisionSnapshot;
  /** Unified state used. */
  unifiedState: UnifiedFitCoachState;
  /** Diagnoses that drove this decision. */
  diagnoses: readonly UnifiedDiagnosis[];
  /** Selected interventions. */
  interventions: readonly ValidatedInterventionCandidate[];
}

// ---------------------------------------------------------------------------
// Decision Outcome — feedback loop for adaptive coaching
// ---------------------------------------------------------------------------

/**
 * Verdict on a decision's outcome after its review window.
 */
export type DecisionOutcomeVerdict =
  | "improved_as_expected"
  | "partially_improved"
  | "no_effect"
  | "worsened"
  | "uncertain"
  | "too_early";

/**
 * Result of re-evaluating a decision against real-world data.
 */
export interface DecisionOutcome extends BaseEntity {
  /** The decision this outcome evaluates. */
  decisionSnapshotId: DecisionSnapshotId;
  /** When the evaluation was performed. */
  evaluatedAt: Timestamp;
  /** Evaluation window description. */
  evaluationWindow: string;
  /** Overall verdict. */
  verdict: DecisionOutcomeVerdict;
  /** Per-intervention verdicts. */
  interventionVerdicts: readonly {
    interventionId: InterventionId;
    verdict: DecisionOutcomeVerdict;
    observations: readonly string[];
  }[];
  /** Observations from the evaluation window. */
  observations: readonly string[];
  /** Explanation of the outcome. */
  explanation: string;
  /** Follow-up diagnosis ID if a new problem emerged. */
  followUpDiagnosisId?: DiagnosisId;
  /** Whether this outcome triggers a new decision cycle. */
  triggersReevaluation: boolean;
}

// ---------------------------------------------------------------------------
// Decision Outcome Evaluation — feedback loop for adaptive coaching
// ---------------------------------------------------------------------------

/**
 * Input for evaluating a decision's outcome against current state.
 */
export interface DecisionOutcomeEvaluationInput {
  /** The decision snapshot to evaluate. */
  decisionSnapshot: DecisionSnapshot;
  /** Current unified state for comparison. */
  currentUnifiedState: UnifiedFitCoachState;
  /** Evaluation window in days since decision. */
  evaluationWindowDays: number;
  /** The verdict recorded by the user/coach, if any. Considered alongside measured evidence. */
  recordedVerdict?: DecisionOutcomeVerdict;
}

/**
 * Result of evaluating a decision's outcome.
 */
export interface DecisionOutcomeEvaluationResult {
  /** Overall verdict. */
  verdict: DecisionOutcomeVerdict;
  /** Per-intervention verdicts. */
  interventionVerdicts: Array<{
    interventionIndex: number;
    verdict: DecisionOutcomeVerdict;
    observations: readonly string[];
  }>;
  /** Aggregated observations. */
  observations: readonly string[];
  /** Human-readable explanation. */
  explanation: string;
  /** Follow-up diagnosis IDs if new problems emerged. */
  followUpDiagnosisIds: readonly DiagnosisId[];
  /** Whether this outcome should trigger a new decision cycle. */
  triggersReevaluation: boolean;
}

// ---------------------------------------------------------------------------
// Recommendation — user-facing communication of validated decisions
// ---------------------------------------------------------------------------
// Note: Recommendation is defined in coaching.ts and re-exported from there.
// This avoids duplicate export conflicts.