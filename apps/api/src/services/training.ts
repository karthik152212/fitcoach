import type {
  CreatePlanInput,
  CreateWorkoutInput,
  ExerciseSetRecord,
  PlanVersionInput,
  Repositories,
  WorkoutAggregate,
  WorkoutHistoryQuery,
  WorkoutRecord,
} from "@fitcoach/db";
import type { SetKind, Timestamp, WorkoutStatus } from "@fitcoach/domain";
import { ConflictError, NotFoundError } from "@fitcoach/db";

/**
 * Training service. Traceability rule (milestone §6): when a workout follows
 * a plan, its plan_version_id is resolved at creation time — defaulting to
 * the plan's latest version — so historical workouts stay explainable after
 * the plan changes.
 */

export interface CreatePlanCommand {
  id?: string;
  name: string;
  status?: string;
  notes?: string;
  version: PlanVersionInput;
}

export interface CreateWorkoutCommand {
  id?: string;
  planId?: string;
  planVersionId?: string;
  planSessionId?: string;
  title?: string;
  status?: WorkoutStatus;
  startedAt?: Timestamp;
  endedAt?: Timestamp;
  notes?: string;
  clientRequestId?: string;
}

export interface RecordSetCommand {
  id?: string;
  workoutExerciseId?: string;
  exerciseId?: string;
  position?: number;
  kind: SetKind;
  loadKg?: number;
  addedLoadKg?: number;
  reps?: number;
  distanceMeters?: number;
  durationSeconds?: number;
  rir?: number;
  rpe?: number;
  notes?: string;
}

export class TrainingService {
  constructor(private readonly repos: Repositories) {}

  private async requireWorkout(workoutId: string): Promise<WorkoutRecord> {
    const aggregate = await this.repos.workouts.findById(workoutId);
    if (!aggregate) throw new NotFoundError(`workout ${workoutId} not found`);
    return aggregate.workout;
  }

  createPlan(userId: string, command: CreatePlanCommand) {
    const input: CreatePlanInput = {
      ...(command.id ? { id: command.id } : {}),
      userId,
      name: command.name,
      ...(command.status ? { status: command.status } : {}),
      ...(command.notes !== undefined ? { notes: command.notes } : {}),
      version: command.version,
    };
    return this.repos.trainingPlans.create(input);
  }

  addVersion(planId: string, version: PlanVersionInput) {
    return this.repos.trainingPlans.addVersion(planId, version);
  }

  async getPlan(planId: string) {
    const plan = await this.repos.trainingPlans.findById(planId);
    if (!plan) throw new NotFoundError(`training plan ${planId} not found`);
    return plan;
  }

  listPlans(userId: string) {
    return this.repos.trainingPlans.listForUser(userId);
  }

  getActivePlan(userId: string) {
    return this.repos.trainingPlans.findActive(userId);
  }

  async createWorkout(userId: string, command: CreateWorkoutCommand): Promise<WorkoutRecord> {
    let planVersionId = command.planVersionId;
    if (command.planId && !planVersionId) {
      const plan = await this.getPlan(command.planId);
      if (plan.userId !== userId) throw new NotFoundError(`training plan ${command.planId} not found`);
      const latest = plan.versions[plan.versions.length - 1];
      planVersionId = latest?.id;
    }

    const input: CreateWorkoutInput = {
      ...(command.id ? { id: command.id } : {}),
      userId,
      ...(command.planId ? { planId: command.planId } : {}),
      ...(planVersionId ? { planVersionId } : {}),
      ...(command.planSessionId ? { planSessionId: command.planSessionId } : {}),
      ...(command.title !== undefined ? { title: command.title } : {}),
      ...(command.status ? { status: command.status } : {}),
      startedAt: command.startedAt ?? new Date().toISOString(),
      ...(command.endedAt ? { endedAt: command.endedAt } : {}),
      ...(command.notes !== undefined ? { notes: command.notes } : {}),
      ...(command.clientRequestId ? { clientRequestId: command.clientRequestId } : {}),
    };
    return this.repos.workouts.create(input);
  }

  async recordExercise(
    workoutId: string,
    command: { exerciseId: string; position?: number; notes?: string },
  ) {
    await this.requireWorkout(workoutId);
    return this.repos.workouts.addExercise(
      workoutId,
      command.exerciseId,
      command.position,
      command.notes,
    );
  }

  /**
   * Record a set either against an explicit workout-exercise group or, when
   * given an exerciseId, against the matching group (created if new).
   */
  async recordSet(workoutId: string, command: RecordSetCommand): Promise<ExerciseSetRecord> {
    await this.requireWorkout(workoutId);

    let workoutExerciseId = command.workoutExerciseId;
    if (!workoutExerciseId) {
      if (!command.exerciseId) {
        throw new ConflictError("either workoutExerciseId or exerciseId is required");
      }
      const aggregate = await this.repos.workouts.findById(workoutId);
      const existing = aggregate?.exercises.find(
        (group) => group.exerciseId === command.exerciseId,
      );
      if (existing) {
        workoutExerciseId = existing.id;
      } else {
        const group = await this.repos.workouts.addExercise(
          workoutId,
          command.exerciseId,
          undefined,
          undefined,
        );
        workoutExerciseId = group.id;
      }
    }

    return this.repos.workouts.addSet({
      ...(command.id ? { id: command.id } : {}),
      workoutExerciseId,
      ...(command.position !== undefined ? { position: command.position } : {}),
      kind: command.kind,
      ...(command.loadKg !== undefined ? { loadKg: command.loadKg } : {}),
      ...(command.addedLoadKg !== undefined ? { addedLoadKg: command.addedLoadKg } : {}),
      ...(command.reps !== undefined ? { reps: command.reps } : {}),
      ...(command.distanceMeters !== undefined ? { distanceMeters: command.distanceMeters } : {}),
      ...(command.durationSeconds !== undefined ? { durationSeconds: command.durationSeconds } : {}),
      ...(command.rir !== undefined ? { rir: command.rir } : {}),
      ...(command.rpe !== undefined ? { rpe: command.rpe } : {}),
      ...(command.notes !== undefined ? { notes: command.notes } : {}),
    });
  }

  complete(
    workoutId: string,
    command: { status?: WorkoutStatus; endedAt?: Timestamp } = {},
  ): Promise<WorkoutRecord> {
    return this.repos.workouts.complete(workoutId, command.status, command.endedAt);
  }

  async getWorkout(workoutId: string): Promise<WorkoutAggregate> {
    const aggregate = await this.repos.workouts.findById(workoutId);
    if (!aggregate) throw new NotFoundError(`workout ${workoutId} not found`);
    return aggregate;
  }

  history(userId: string, query: WorkoutHistoryQuery): Promise<WorkoutAggregate[]> {
    return this.repos.workouts.history(userId, query);
  }
}
