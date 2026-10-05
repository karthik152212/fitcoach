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
  notes?: string;
}
