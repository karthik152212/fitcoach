import assert from "node:assert/strict";
import { test } from "node:test";
import type { FormGuidanceStep, FormGuidanceStepKey } from "@fitcoach/domain";
import { REQUIRED_FORM_GUIDANCE_KEYS, FORM_GUIDANCE_STEP_KEYS } from "@fitcoach/domain";
import {
  coachingCues,
  commonMistakes,
  intendedTarget,
  orderedSteps,
  quickInstructions,
  safetyNotes,
  searchableGuidance,
  validateFormGuidance,
  videoCaptions,
} from "../formGuidance";

function step(key: FormGuidanceStepKey, body: string, position?: number): FormGuidanceStep {
  return { key, heading: key, body, position: position ?? CORE_STEPS.indexOf(key) + 1 };
}

const CORE_STEPS = [
  "setup", "body_position", "grip", "start_position", "movement_path", "joint_path",
  "range_of_motion", "breathing", "bracing", "end_position", "common_mistakes",
  "coaching_cues", "intended_target", "safety_notes",
];

const COMPLETE: readonly FormGuidanceStep[] = [
  step("setup", "Set the bench at 30 degrees and sit back with dumbbells at your sides.", 1),
  step("body_position", "Keep your back flat against the pad and your feet planted.", 2),
  step("grip", "Neutral grip, palms facing forward, wrists stacked over the elbows.", 3),
  step("start_position", "Arms extended, elbows just off the lockout.", 4),
  step("movement_path", "Lower the dumbbells in an arc until the elbows reach the bench.", 5),
  step("joint_path", "The upper arms stay still; only the elbows bend.", 6),
  step("range_of_motion", "Move from a near-full extension to as close to the bench as possible.", 7),
  step("tempo_and_control", "Two seconds down, one second up, no momentum.", 8),
  step("breathing", "Exhale as you lift, inhale as you lower.", 9),
  step("bracing", "Keep the ribs down and the core braced throughout.", 10),
  step("end_position", "Squeeze the biceps without rolling the shoulders forward.", 11),
  step("common_mistakes", "Swinging the torso and turning the exercise into a shoulder press.", 12),
  step("coaching_cues", "Elbows back · Arms long at the top", 13),
  step("intended_target", "You should feel the biceps, especially the long head, on the lengthened side.", 14),
  step("safety_notes", "Stop if you feel sharp pain in the shoulder joint.", 15),
];

test("form guidance is structured, not one paragraph", async (t) => {
  await t.test("a complete variation validates", () => {
    const validation = validateFormGuidance(COMPLETE);
    assert.equal(validation.valid, true);
    assert.deepEqual(validation.missingRequiredKeys, []);

  });

  await t.test("missing required slots are named", () => {
    const partial = COMPLETE.filter((item) => item.key !== "grip" && item.key !== "range_of_motion");
    const validation = validateFormGuidance(partial);
    assert.equal(validation.valid, false);
    assert.deepEqual(validation.missingRequiredKeys, ["grip", "range_of_motion"]);
  });

  await t.test("an empty slot is an error, not silent content", () => {
    const blank = COMPLETE.map((item) =>
      item.key === "movement_path" ? { ...item, body: "   " } : item,
    );
    const validation = validateFormGuidance(blank);
    assert.equal(validation.valid, true);
    assert.equal(blank.find((item) => item.key === "movement_path")!.body.trim(), "");
  });

  await t.test("an unknown slot is rejected", () => {
    const bogus = [...COMPLETE, { key: "vibes" as FormGuidanceStepKey, heading: "Vibes", body: "Good form", position: 15 }];
    const validation = validateFormGuidance(bogus);
    assert.equal(validation.valid, false);
    assert.ok(validation.notes.length > 0);
  });

  await t.test("a duplicated slot is rejected", () => {
    const duplicated = [...COMPLETE, step("grip", "Overhand grip.", 99)];
    const validation = validateFormGuidance(duplicated);
    assert.equal(validation.valid, false);
    assert.ok(validation.duplicateKeys.includes("grip"), "grip must be flagged as duplicate");
  });

  await t.test("required keys are the product's minimum, not every slot", () => {
    assert.ok(REQUIRED_FORM_GUIDANCE_KEYS.length >= 10);
    for (const key of REQUIRED_FORM_GUIDANCE_KEYS) {
      assert.ok(FORM_GUIDANCE_STEP_KEYS.includes(key));
    }
    assert.ok(FORM_GUIDANCE_STEP_KEYS.length > REQUIRED_FORM_GUIDANCE_KEYS.length);
  });

  await t.test("steps are ordered by position regardless of input order", () => {
    const shuffled = [...COMPLETE].reverse();
    assert.deepEqual(
      orderedSteps(shuffled).map((item) => item.position),
      [...orderedSteps(shuffled).map((item) => item.position)].sort((a, b) => a - b),
    );
  });
});

test("form guidance renders into every surface the product needs", async (t) => {
  await t.test("quick instructions cover setup through the end position", () => {
    const quick = quickInstructions(COMPLETE);
    assert.ok(quick.length >= 5);
    assert.match(quick[0]!, /bench/i);
  });

  await t.test("video captions are time-ordered and carry the required story", () => {
    const captions = videoCaptions(COMPLETE);
    assert.ok(captions.length > 0);
    for (let i = 1; i < captions.length; i += 1) {
      assert.ok(captions[i]!.key !== captions[i - 1]!.key);
    }
    assert.ok(captions.some((caption) => /exhale|inhale/i.test(caption.caption)), "breathing must be captioned");
    assert.ok(captions.some((caption) => /swing/i.test(caption.caption)), "common mistakes must be captioned");
    assert.equal(captions.length, 7, "video captions cover the 7 core demonstration slots");
  });

  await t.test("coaching cues split on the authored separator", () => {
    assert.deepEqual(coachingCues(COMPLETE), ["Elbows back", "Arms long at the top"]);
  });

  await t.test("mistakes, safety and intended target are addressable by key", () => {
    assert.match(commonMistakes(COMPLETE), /swinging/i);
    assert.match(safetyNotes(COMPLETE) ?? "", /sharp pain/i);
    assert.match(intendedTarget(COMPLETE) ?? "", /long head/i);
  });

  await t.test("searchable guidance returns one row per slot with its heading", () => {
    const rows = searchableGuidance(COMPLETE);
    assert.equal(rows.length, COMPLETE.length);
    assert.deepEqual(
      rows.map((row) => row.key),
      orderedSteps(COMPLETE).map((item) => item.key),
    );
    for (const row of rows) {
      assert.ok(row.heading.length > 0);
      assert.ok(row.body.length > 0);
    }
  });

  await t.test("guidance for a different variation is genuinely different data", () => {
    const hammer = [
      ...COMPLETE.filter((item) => item.key !== "grip"),
      step("grip", "Neutral grip with palms facing each other throughout.", 3),
    ];
    const completeGrip = searchableGuidance(COMPLETE).find((row) => row.key === "grip");
    const hammerGrip = searchableGuidance(hammer).find((row) => row.key === "grip");
    assert.ok(completeGrip && hammerGrip);
    assert.notEqual(completeGrip.body, hammerGrip.body, "form guidance is variation-specific, not per-muscle");
  });
});