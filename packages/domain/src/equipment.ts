import type { BaseEntity, UserId } from "./shared";

export type EquipmentCategory =
  | "barbell"
  | "dumbbell"
  | "kettlebell"
  | "machine"
  | "cable"
  | "smith_machine"
  | "bench"
  | "rack"
  | "pull_up_bar"
  | "bands"
  | "bodyweight"
  | "cardio_machine"
  | "accessory"
  | "other";

/**
 * Usability of an owned piece of equipment while its availability row is open
 * (Phase 2, §16). This is deliberately *not* part of the catalog: availability
 * is a property of the user's relationship to a piece of equipment, which is
 * why it lives on the interval row and can change by opening a new interval.
 */
export type EquipmentAvailability = "available" | "temporarily_unavailable" | "unavailable";

export const EQUIPMENT_AVAILABILITIES: readonly EquipmentAvailability[] = [
  "available",
  "temporarily_unavailable",
  "unavailable",
] as const;

/**
 * A piece of equipment available to a specific user (their gym inventory,
 * gathered via the guided onboarding interview). Derived exercise
 * availability is computed by fitness-core, never stored here.
 */
export interface Equipment extends BaseEntity {
  ownerUserId: UserId;
  name: string;
  category: EquipmentCategory;
  /** Free-form specs (e.g. max dumbbell weight, stack height) until modeled. */
  specifications?: Readonly<Record<string, number>>;
  available: boolean;
  /** Present when the user owns it but cannot use it right now. */
  availability?: EquipmentAvailability;
  notes?: string;
}
