import type {
  Diagnosis,
  Goal,
  Intervention,
  InterventionKind,
  InterventionParameters,
} from "@fitcoach/domain";
import { NotImplementedError } from "./errors";

export interface InterventionSelectionContext {
  goal?: Goal;
  activeInterventions: readonly Intervention[];
  constraints: readonly string[];
}

export interface InterventionCandidate {
  kind: InterventionKind;
  parameters: InterventionParameters;
  rationale: string;
  expectedEffect: string;
  /**
   * Lower = try first. Selection prefers the smallest intervention likely to
   * solve the problem (PRODUCT_SPEC principle 7).
   */
  precedenceRank: number;
}

/**
 * Choose validated intervention candidates for the given diagnoses.
 * Candidates are returned unpersisted: creating Intervention records (ids,
 * status lifecycle, outcomes) is the application layer's responsibility.
 */
export function selectInterventionCandidates(
  _diagnoses: readonly Diagnosis[],
  _context: InterventionSelectionContext,
): InterventionCandidate[] {
  throw new NotImplementedError("interventionSelection.selectInterventionCandidates");
}
