import type { CalendarDate } from "@fitcoach/domain";
import { NotImplementedError } from "./errors";

export interface TrendPoint {
  date: CalendarDate;
  value: number;
}

export type TrendDirection = "increasing" | "decreasing" | "stable" | "insufficient_data";

export interface TrendAnalysis {
  direction: TrendDirection;
  /** Estimated change per day; null when direction is insufficient_data. */
  slopePerDay: number | null;
  /** 0..1 confidence that the detected direction is real rather than noise. */
  confidence: number | null;
  pointsUsed: number;
  warnings: readonly string[];
}

export interface TrendOptions {
  /** Minimum number of valid points required before a trend is reported. */
  minPoints?: number;
  /** Rolling window used for smoothing noisy measurements, in days. */
  smoothingWindowDays?: number;
}

/**
 * Detect whether a metric (body weight, waist, calories, ...) is genuinely
 * moving. All coaching conclusions about progress must come from functions
 * like this operating on multiple records — never from single data points.
 */
export function detectTrend(
  _points: readonly TrendPoint[],
  _options?: TrendOptions,
): TrendAnalysis {
  throw new NotImplementedError("trendDetection.detectTrend");
}
