import { expect, test } from "@playwright/test";
import { seedApp, USER_ID, EXERCISE_ID, WORKOUT_ID } from "./fixtures/api";

/**
 * The primary journey, end to end: dashboard → plan → training → exercise →
 * performance → review → progress → profile. Every write goes through the real
 * API client and the real session store; only the server is recorded.
 */
test("a complete training session, from dashboard to review", async ({ page }) => {
  const state = await seedApp(page);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await test.step("home names today's session and offers the next action", async () => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Upper A — today", { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Start training" })).toBeVisible();
  });

  await test.step("the plan explains the week before the session", async () => {
    await page.goto("/plan");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bodybuilding");
    await expect(page.getByText("What the week trains")).toBeVisible();
    // Rest days are information, not links (two sessions across seven days).
    await expect(page.locator(".fc-week__cell.is-rest")).toHaveCount(5);
    await expect(page.locator("a.fc-week__cell.is-rest")).toHaveCount(0);
  });

  await test.step("train lists the session's exercises", async () => {
    await page.goto("/train");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Upper A");
    await expect(page.getByRole("list", { name: "Exercises" })).toContainText("Barbell bench press");
    await page.getByRole("link", { name: /Barbell bench press/ }).click();
    await expect(page).toHaveURL(new RegExp(`/exercise/${EXERCISE_ID}$`));
  });

  await test.step("the exercise screen shows the target before starting", async () => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Barbell bench press");
    await expect(page.getByRole("region", { name: "Target" })).toContainText("Pectoralis major");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page).toHaveURL(new RegExp(`/exercise/${EXERCISE_ID}/perform$`));
  });

  await test.step("two working sets are logged with distinct ids", async () => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Barbell bench press");

    await page.getByRole("button", { name: "Add set" }).click();
    await page.getByRole("button", { name: "✓ Save set" }).click();
    await expect(page.getByRole("list", { name: "Logged sets" }).getByRole("listitem")).toHaveCount(1);

    await page.getByRole("button", { name: "Add set" }).click();
    await page.getByRole("button", { name: "Increase Reps" }).click();
    await page.getByRole("button", { name: "✓ Save set" }).click();

    const logged = page.getByRole("list", { name: "Logged sets" }).getByRole("listitem");
    await expect(logged).toHaveCount(2);
    await expect(logged.nth(0)).toHaveText("60 kg × 10");
    await expect(logged.nth(1)).toHaveText("60 kg × 11");

    // Persisted sets are keyed by the server id, never by array index.
    const ids = await logged.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-set-id")));
    expect(new Set(ids).size).toBe(2);
    expect(state.sets).toHaveLength(2);
  });

  await test.step("finishing records the session and opens its review", async () => {
    await page.getByRole("button", { name: "Finish workout" }).click();
    await expect(page).toHaveURL(new RegExp(`/review/${WORKOUT_ID}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Session · 2 sets");
    await expect(page.getByRole("region", { name: "Performed work" })).toContainText("60 kg × 10");
    await expect(page.getByRole("region", { name: "Performed work" })).toContainText("60 kg × 11");
    await expect(page.getByText("No change recommended.")).toBeVisible();
  });

  await test.step("home stops asking to start a session already done today", async () => {
    await page.getByRole("link", { name: "Done" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Upper A — complete");
    await expect(page.getByRole("button", { name: "Review session" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start training" })).toHaveCount(0);
  });

  await test.step("progress keeps the session and links to its review", async () => {
    await page.goto("/progress");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Training record");
    await expect(page.getByRole("link", { name: /Review/ }).first()).toBeVisible();
  });

  await test.step("the profile reflects the recorded context", async () => {
    await page.goto("/you");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sam Rivera");
    await expect(page.getByRole("region", { name: "Training context" })).toContainText("Bodybuilding");
    await expect(page.getByRole("region", { name: "Training context" })).toContainText("3 days · 60 min");
  });

  // The whole flow is recorded, and nothing complained along the way.
  expect(state.calls).toContain(`POST /v0/users/${USER_ID}/workouts`);
  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
});

test("a failed plan read offers a retry instead of re-onboarding", async ({ page }) => {
  await seedApp(page);
  await page.route("**/v0/users/*/training-plans/active", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "internal", message: "Something went wrong. Retry in a moment." }),
    }),
  );

  await page.goto("/plan");
  await expect(page.getByText("Couldn't load your plan")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  // A user who already has a plan must never be pushed back to onboarding.
  await expect(page.getByText("Build my plan")).toHaveCount(0);
});

test("a failed equipment catalogue blocks onboarding instead of inventing one", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.removeItem("fitcoach.userId"));
  await page.route("**/v0/equipment", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "internal", message: "Something went wrong. Retry in a moment." }),
    }),
  );

  await page.goto("/onboarding");
  await page.getByRole("textbox", { name: "What should FitCoach call you?" }).fill("Sam");

  // Walk the interview one step at a time, waiting for each screen so a click
  // can never land on a step that has already been left behind.
  const step = async (heading: string) => {
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
  };
  await step("Your body");
  await step("Your training");
  await step("What are you training for?");
  await step("Where do you train?");

  await page.getByRole("radio", { name: /^Home Whatever/ }).click();
  await step("Free weights");

  await expect(page.getByText("Couldn't load the equipment list")).toBeVisible();
  // Continuing without the catalogue would quietly record "no equipment".
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/equipment list did not load/i)).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding$/);
});
