import type { PrismaClient } from "@prisma/client";
import type { CalendarDate, Goal, GoalKind, PhysiqueTarget } from "@fitcoach/domain";
import { ConflictError, ConstraintValidationError, NotFoundError } from "../errors";
import { newUuidv7 } from "../ids";
import { decimalToNumber, toCalendarDate, toTimestamp } from "../mapping";
import { runDb } from "./util";

interface GoalRow {
  id: string;
  userId: string;
  supersededByGoalId: string | null;
  kind: string;
  description: string | null;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface GoalPriorityRow {
  position: number;
  tag: string;
}

interface PhysiqueTargetRow {
  bodyWeightKg: unknown;
  bodyFatPercent: unknown;
  waistCm: unknown;
  chestCm: unknown;
  shoulderCircumferenceCm: unknown;
  armCm: unknown;
  thighCm: unknown;
  calfCm: unknown;
  notes: string | null;
}

export interface GoalRecord extends Goal {
  /** Set once this goal has been replaced by a newer one. */
  supersededByGoalId?: string;
}

interface GoalWithChildren extends GoalRow {
  priorities: GoalPriorityRow[];
  physiqueTarget: PhysiqueTargetRow | null;
}

function physiqueTargetToRecord(row: PhysiqueTargetRow): PhysiqueTarget {
  return {
    bodyWeightKg: decimalToNumber(row.bodyWeightKg),
    bodyFatPercent: decimalToNumber(row.bodyFatPercent),
    waistCm: decimalToNumber(row.waistCm),
    chestCm: decimalToNumber(row.chestCm),
    shoulderCircumferenceCm: decimalToNumber(row.shoulderCircumferenceCm),
    armCm: decimalToNumber(row.armCm),
    thighCm: decimalToNumber(row.thighCm),
    calfCm: decimalToNumber(row.calfCm),
    notes: row.notes ?? undefined,
  };
}

function goalRowToRecord(row: GoalWithChildren): GoalRecord {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind as GoalKind,
    description: row.description ?? undefined,
    priorities: row.priorities
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((priority) => priority.tag),
    physiqueTarget: row.physiqueTarget ? physiqueTargetToRecord(row.physiqueTarget) : undefined,
    effectiveFrom: toCalendarDate(row.effectiveFrom),
    effectiveUntil: row.effectiveUntil ? toCalendarDate(row.effectiveUntil) : undefined,
    supersededByGoalId: row.supersededByGoalId ?? undefined,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

const GOAL_INCLUDE = {
  priorities: true,
  physiqueTarget: true,
} as const;

export interface CreateGoalInput {
  /** Client-supplied id (idempotent retries) or omitted for a fresh UUIDv7. */
  id?: string;
  userId: string;
  kind: GoalKind;
  description?: string;
  /** User-local day the goal takes effect. */
  effectiveFrom: CalendarDate;
  /** Ordered most-important-first. */
  priorities?: readonly string[];
  physiqueTarget?: PhysiqueTarget;
}

export interface GoalRepository {
  /**
   * Create a goal version. Any currently active goal is closed
   * (effective_until = new.effective_from, superseded_by = new id) inside the
   * same transaction, so at most one goal is ever active per user.
   */
  create(input: CreateGoalInput): Promise<GoalRecord>;
  active(userId: string): Promise<GoalRecord | null>;
  /** All versions, newest effective_from first. */
  history(userId: string): Promise<GoalRecord[]>;
  findById(id: string): Promise<GoalRecord | null>;
}

function parseDate(value: CalendarDate, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ConstraintValidationError(`${field} must be YYYY-MM-DD`);
  }
  return new Date(`${value}T00:00:00.000Z`);
}

export class PrismaGoalRepository implements GoalRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async load(
    id: string,
    client: Pick<PrismaClient, "goal"> = this.prisma,
  ): Promise<GoalRecord | null> {
    const row = await client.goal.findUnique({ where: { id }, include: GOAL_INCLUDE });
    return row ? goalRowToRecord(row) : null;
  }

  async create(input: CreateGoalInput): Promise<GoalRecord> {
    const newId = input.id ?? newUuidv7();
    const effectiveFrom = parseDate(input.effectiveFrom, "effectiveFrom");

    return runDb(async () => {
      return this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } });
        if (!user) throw new NotFoundError(`user ${input.userId} not found`);

        const current = await tx.goal.findFirst({
          where: { userId: input.userId, effectiveUntil: null },
          orderBy: { effectiveFrom: "desc" },
        });

        if (current) {
          if (effectiveFrom.getTime() <= current.effectiveFrom.getTime()) {
            throw new ConflictError(
              "new goal must start after the current active goal's effective_from",
            );
          }
          // Close the previous version — content columns stay frozen; only
          // lifecycle columns move (enforced by the goals lifecycle trigger).
          await tx.goal.update({
            where: { id: current.id },
            data: {
              effectiveUntil: effectiveFrom,
              supersededByGoalId: newId,
            },
          });
        }

        await tx.goal.create({
          data: {
            id: newId,
            userId: input.userId,
            kind: input.kind,
            description: input.description ?? null,
            effectiveFrom,
            effectiveUntil: null,
            priorities: {
              create: (input.priorities ?? []).map((tag, index) => ({
                id: newUuidv7(),
                position: index,
                tag,
              })),
            },
            ...(input.physiqueTarget
              ? {
                  physiqueTarget: {
                    create: {
                      id: newUuidv7(),
                      bodyWeightKg: input.physiqueTarget.bodyWeightKg ?? null,
                      bodyFatPercent: input.physiqueTarget.bodyFatPercent ?? null,
                      waistCm: input.physiqueTarget.waistCm ?? null,
                      chestCm: input.physiqueTarget.chestCm ?? null,
                      shoulderCircumferenceCm:
                        input.physiqueTarget.shoulderCircumferenceCm ?? null,
                      armCm: input.physiqueTarget.armCm ?? null,
                      thighCm: input.physiqueTarget.thighCm ?? null,
                      calfCm: input.physiqueTarget.calfCm ?? null,
                      notes: input.physiqueTarget.notes ?? null,
                    },
                  },
                }
              : {}),
          },
        });

        // Read back through the transaction: the outer pool cannot see the
        // uncommitted row.
        const created = await this.load(newId, tx);
        if (!created) throw new NotFoundError("goal disappeared after create");
        return created;
      });
    });
  }

  async active(userId: string): Promise<GoalRecord | null> {
    return runDb(async () => {
      const row = await this.prisma.goal.findFirst({
        where: { userId, effectiveUntil: null },
        include: GOAL_INCLUDE,
        orderBy: { effectiveFrom: "desc" },
      });
      return row ? goalRowToRecord(row) : null;
    });
  }

  async history(userId: string): Promise<GoalRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.goal.findMany({
        where: { userId },
        include: GOAL_INCLUDE,
        orderBy: { effectiveFrom: "desc" },
      });
      return rows.map(goalRowToRecord);
    });
  }

  async findById(id: string): Promise<GoalRecord | null> {
    return runDb(() => this.load(id));
  }
}
