import type {
  ActivityRecord,
  BodyMeasurement,
  CalendarDate,
  DailyNutrition,
  Diagnosis,
  Intervention,
  UserId,
  Workout,
} from "@fitcoach/domain";
import { NotImplementedError } from "./errors";

export interface DiagnosisDataSlice {
  workouts: readonly Workout[];
  bodyMeasurements: readonly BodyMeasurement[];
  activityRecords: readonly ActivityRecord[];
  dailyNutrition: readonly DailyNutrition[];
  activeInterventions: readonly Intervention[];
}

export interface DiagnosisRequest {
  userId: UserId;
  /** The day the analysis runs; anchors all windows. */
  today: CalendarDate;
  analysisWindowDays: number;
  data: DiagnosisDataSlice;
}

/**
 * Run deterministic diagnosis over a user's recent data. Returns diagnoses
 * (possibly empty — "nothing needs changing" is a valid result). Diagnoses
 * feed intervention selection; the AI layer only explains what comes out.
 */
export function runDiagnoses(_request: DiagnosisRequest): Diagnosis[] {
  throw new NotImplementedError("diagnosis.runDiagnoses");
}
