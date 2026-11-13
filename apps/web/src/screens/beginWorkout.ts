import { newClientRequestId } from "../api/client";
import * as endpoints from "../api/endpoints";
import type { ExerciseDetail, SessionClassification, TrainingEnvironmentKind } from "../api/types";
import type { useWorkout } from "../session/WorkoutContext";

/**
 * Start-of-performance plumbing.
 *
 * Reuses the in-progress workout when one exists, or creates it against the
 * active plan + environment, then registers the exercise group. All training
 * facts come from the backend; this is wiring only.
 */
export async function beginWorkoutForExercise(
  userId: string,
  workout: ReturnType<typeof useWorkout>,
  exerciseId: string,
  exerciseName: string,
  detail: ExerciseDetail,
): Promise<void> {
  let workoutId = workout.active?.workoutId;

  if (!workoutId) {
    const [environment, plan] = await Promise.all([
      endpoints.getActiveEnvironment(userId).catch(() => null),
      endpoints.getActivePlan(userId).catch(() => ({ plan: null })),
    ]);
    // The engine's vocabulary: a session run in a constrained environment is
    // `adapted`; otherwise it is the planned session.
    const classification: SessionClassification =
      environment && environment.environment.constrained ? "adapted" : "planned";
    const { workout: created } = await endpoints.createWorkout(userId, {
      ...(plan.plan ? { planId: plan.plan.id } : {}),
      startedAt: new Date().toISOString(),
      status: "in_progress",
      clientRequestId: newClientRequestId(),
      ...(environment ? { environmentKind: environment.environment.kind as TrainingEnvironmentKind } : {}),
      sessionClassification: classification,
    });
    workoutId = created.id;
    workout.begin({
      workoutId,
      ...(plan.plan ? { planId: plan.plan.id } : {}),
      ...(environment ? { environmentKind: environment.environment.kind as TrainingEnvironmentKind } : {}),
      sessionClassification: classification,
      startedAt: created.startedAt,
    });
  }

  if (workout.active?.exercise?.exerciseId !== exerciseId) {
    const { workoutExercise } = await endpoints.addWorkoutExercise(userId, workoutId, exerciseId);
    workout.selectExercise({
      exerciseId,
      workoutExerciseId: workoutExercise.id,
      name: exerciseName,
      loadKind: detail.exercise.loadingCharacteristic === "bodyweight_only" ? "bodyweight" : "external_load",
    });
  }
}
