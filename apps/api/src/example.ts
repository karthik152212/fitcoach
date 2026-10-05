import type { User } from "@fitcoach/domain";

/**
 * Deterministic formatting over domain data. Even this example follows the
 * architecture rule: it renders domain facts, it does not invent them.
 * (Kept from the placeholder server for continuity.)
 */
export function createUserSummary(user: User): string {
  const segments: string[] = [
    user.displayName ? `${user.displayName} (${user.id})` : user.id,
  ];
  const profile = user.profile;
  if (profile.sex) {
    segments.push(`sex=${profile.sex}`);
  }
  if (profile.heightCm !== undefined) {
    segments.push(`height=${profile.heightCm}cm`);
  }
  if (profile.trainingExperience) {
    segments.push(`experience=${profile.trainingExperience}`);
  }
  if (profile.trainingDaysPerWeek !== undefined) {
    segments.push(`trainingDays/week=${profile.trainingDaysPerWeek}`);
  }
  return segments.join(", ");
}

/** Placeholder example demonstrating the domain model. */
export function buildExampleUser(): User {
  const now = new Date().toISOString();
  return {
    id: "usr_example",
    createdAt: now,
    updatedAt: now,
    displayName: "Example Athlete",
    timezone: "UTC",
    profile: {
      heightCm: 180,
      sex: "male",
      trainingExperience: "intermediate",
      trainingDaysPerWeek: 4,
      sessionDurationMinutes: 60,
      limitations: [],
      unitSystem: "metric",
    },
  };
}
