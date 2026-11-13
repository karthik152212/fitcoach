/**
 * Onboarding validation tests.
 *
 * The interview must not hand the engine a height of 0 or a 15-minute session:
 * invalid answers get a sentence next to the step, not a build failure.
 */

import { describe, expect, it } from "vitest";
import { validateInterviewStep, type InterviewAnswers } from "../screens/OnboardingScreen";

const valid: InterviewAnswers = {
  email: "",
  heightCm: 178,
  weightKg: 72,
  days: 4,
  sessionMinutes: 60,
};

describe("validateInterviewStep", () => {
  it("accepts a complete, plausible interview", () => {
    expect(validateInterviewStep("welcome", valid)).toBeNull();
    expect(validateInterviewStep("body", valid)).toBeNull();
    expect(validateInterviewStep("training", valid)).toBeNull();
    expect(validateInterviewStep("goal", valid)).toBeNull();
  });

  it("allows an empty optional email but rejects a malformed one", () => {
    expect(validateInterviewStep("welcome", { ...valid, email: "  " })).toBeNull();
    expect(validateInterviewStep("welcome", { ...valid, email: "kai.fitcoach@" })).toMatch(/email/i);
  });

  it("bounds height and optional body weight", () => {
    expect(validateInterviewStep("body", { ...valid, heightCm: 0 })).toMatch(/height/i);
    expect(validateInterviewStep("body", { ...valid, heightCm: 999 })).toMatch(/height/i);
    expect(validateInterviewStep("body", { ...valid, heightCm: Number.NaN })).toMatch(/height/i);
    expect(validateInterviewStep("body", { ...valid, weightKg: null })).toBeNull();
    expect(validateInterviewStep("body", { ...valid, weightKg: 5 })).toMatch(/weight/i);
  });

  it("bounds days and session length", () => {
    expect(validateInterviewStep("training", { ...valid, days: 0 })).toMatch(/days/i);
    expect(validateInterviewStep("training", { ...valid, days: 8 })).toMatch(/days/i);
    expect(validateInterviewStep("training", { ...valid, sessionMinutes: 10 })).toMatch(/minutes/i);
    expect(validateInterviewStep("training", { ...valid, sessionMinutes: 240 })).toMatch(/minutes/i);
  });
});
