import type { PrismaClient } from "@prisma/client";
import type { Profile, Sex, TrainingExperience, UnitSystem, User } from "@fitcoach/domain";
import { assertValidTimezone } from "@fitcoach/domain";
import {
  ConstraintValidationError,
  NotFoundError,
} from "../errors";
import { newUuidv7 } from "../ids";
import { decimalToNumber, toCalendarDate, toTimestamp } from "../mapping";
import { runDb } from "./util";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Row shapes (structural — satisfied by generated Prisma results)
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  email: string | null;
  displayName: string | null;
  externalAuthId: string | null;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ProfileRow {
  userId: string;
  birthDate: Date | null;
  sex: string | null;
  heightCm: unknown;
  trainingExperience: string | null;
  trainingDaysPerWeek: number | null;
  sessionDurationMinutes: number | null;
  limitations: string[];
  unitSystem: string;
}

interface ProfileRevisionRow {
  id: string;
  userId: string;
  birthDate: Date | null;
  sex: string | null;
  heightCm: unknown;
  trainingExperience: string | null;
  trainingDaysPerWeek: number | null;
  sessionDurationMinutes: number | null;
  limitations: string[];
  changedFields: string[];
  reason: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function userRowToRecord(row: UserRow, profile: Profile | null): User {
  return {
    id: row.id,
    email: row.email ?? undefined,
    displayName: row.displayName ?? undefined,
    externalAuthId: row.externalAuthId ?? undefined,
    timezone: row.timezone,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
    profile: profile ?? {},
  };
}

function profileRowToRecord(row: ProfileRow): Profile {
  const record: Profile = {
    birthDate: row.birthDate ? toCalendarDate(row.birthDate) : undefined,
    sex: (row.sex ?? undefined) as Sex | undefined,
    heightCm: decimalToNumber(row.heightCm),
    trainingExperience: (row.trainingExperience ?? undefined) as TrainingExperience | undefined,
    trainingDaysPerWeek: row.trainingDaysPerWeek ?? undefined,
    sessionDurationMinutes: row.sessionDurationMinutes ?? undefined,
    limitations: row.limitations,
    unitSystem: (row.unitSystem ?? "metric") as UnitSystem,
  };
  return record;
}

export interface ProfileRevisionRecord {
  id: string;
  userId: string;
  birthDate?: string;
  sex?: Sex;
  heightCm?: number;
  trainingExperience?: TrainingExperience;
  trainingDaysPerWeek?: number;
  sessionDurationMinutes?: number;
  limitations: string[];
  changedFields: string[];
  reason?: string;
  createdAt: string;
}

function revisionRowToRecord(row: ProfileRevisionRow): ProfileRevisionRecord {
  return {
    id: row.id,
    userId: row.userId,
    birthDate: row.birthDate ? toCalendarDate(row.birthDate) : undefined,
    sex: (row.sex ?? undefined) as Sex | undefined,
    heightCm: decimalToNumber(row.heightCm),
    trainingExperience: (row.trainingExperience ?? undefined) as TrainingExperience | undefined,
    trainingDaysPerWeek: row.trainingDaysPerWeek ?? undefined,
    sessionDurationMinutes: row.sessionDurationMinutes ?? undefined,
    limitations: row.limitations,
    changedFields: row.changedFields,
    reason: row.reason ?? undefined,
    createdAt: toTimestamp(row.createdAt),
  };
}

// ---------------------------------------------------------------------------
// Material-field comparison (profile revisions)
// ---------------------------------------------------------------------------

const MATERIAL_FIELDS = [
  "birthDate",
  "sex",
  "heightCm",
  "trainingExperience",
  "trainingDaysPerWeek",
  "sessionDurationMinutes",
  "limitations",
] as const;

type MaterialField = (typeof MATERIAL_FIELDS)[number];

function normalizeForComparison(profile: Profile): Record<MaterialField, unknown> {
  return {
    birthDate: profile.birthDate ?? null,
    sex: profile.sex ?? null,
    heightCm: profile.heightCm ?? null,
    trainingExperience: profile.trainingExperience ?? null,
    trainingDaysPerWeek: profile.trainingDaysPerWeek ?? null,
    sessionDurationMinutes: profile.sessionDurationMinutes ?? null,
    limitations: [...(profile.limitations ?? [])].sort().join("\u0000"),
  };
}

/**
 * Fields that changed between two profile states. unit_system is a
 * presentation preference and deliberately never produces a revision
 * (schema comment: approved decision 3).
 */
export function changedMaterialFields(before: Profile, after: Profile): MaterialField[] {
  const a = normalizeForComparison(before);
  const b = normalizeForComparison(after);
  return MATERIAL_FIELDS.filter((field) => a[field] !== b[field]);
}

// ---------------------------------------------------------------------------
// Repository contracts
// ---------------------------------------------------------------------------

export interface CreateUserInput {
  id?: string;
  email?: string;
  displayName?: string;
  externalAuthId?: string;
  /** IANA identifier; defaults to "UTC". */
  timezone?: string;
}

export interface UpdateUserInput {
  email?: string;
  displayName?: string;
  timezone?: string;
}

export interface UserRepository {
  create(input: CreateUserInput): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  update(id: string, patch: UpdateUserInput): Promise<User>;
  /** Account erasure (§13): cascades every user-owned row. */
  delete(id: string): Promise<void>;
}

export interface ProfileRepository {
  get(userId: string): Promise<Profile | null>;
  /**
   * Create or update the current profile. Coaching-relevant (material)
   * changes append a ProfileRevision snapshot; unit_system changes do not.
   */
  upsert(userId: string, profile: Profile, reason?: string): Promise<Profile>;
  revisions(userId: string): Promise<ProfileRevisionRecord[]>;
}

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async load(id: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({
      where: { id },
      include: { profile: true },
    });
    if (!row) return null;
    return userRowToRecord(row, row.profile ? profileRowToRecord(row.profile) : null);
  }

  async create(input: CreateUserInput): Promise<User> {
    if (input.email !== undefined && input.email !== null && !EMAIL_PATTERN.test(input.email)) {
      throw new ConstraintValidationError("email is not a valid address");
    }
    let timezone = input.timezone ?? "UTC";
    try {
      timezone = assertValidTimezone(timezone);
    } catch {
      throw new ConstraintValidationError(`invalid IANA timezone: ${input.timezone ?? ""}`);
    }
    const id = input.id ?? newUuidv7();
    return runDb(async () => {
      await this.prisma.user.create({
        data: {
          id,
          email: input.email ?? null,
          displayName: input.displayName ?? null,
          externalAuthId: input.externalAuthId ?? null,
          timezone,
        },
      });
      const created = await this.load(id);
      if (!created) throw new NotFoundError("user disappeared after create");
      return created;
    });
  }

  async findById(id: string): Promise<User | null> {
    return runDb(() => this.load(id));
  }

  async findByEmail(email: string): Promise<User | null> {
    const normalized = email.trim().toLowerCase();
    return runDb(async () => {
      const row = await this.prisma.user.findFirst({
        where: { email: { equals: normalized, mode: "insensitive" } },
        include: { profile: true },
      });
      if (!row) return null;
      return userRowToRecord(row, row.profile ? profileRowToRecord(row.profile) : null);
    });
  }

  async update(id: string, patch: UpdateUserInput): Promise<User> {
    if (patch.email !== undefined && !EMAIL_PATTERN.test(patch.email)) {
      throw new ConstraintValidationError("email is not a valid address");
    }
    if (patch.timezone !== undefined) {
      try {
        assertValidTimezone(patch.timezone);
      } catch {
        throw new ConstraintValidationError(`invalid IANA timezone: ${patch.timezone}`);
      }
    }
    return runDb(async () => {
      const exists = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw new NotFoundError(`user ${id} not found`);
      await this.prisma.user.update({
        where: { id },
        data: {
          ...(patch.email !== undefined ? { email: patch.email } : {}),
          ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
          ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
        },
      });
      const updated = await this.load(id);
      if (!updated) throw new NotFoundError(`user ${id} not found`);
      return updated;
    });
  }

  async delete(id: string): Promise<void> {
    await runDb(async () => {
      try {
        await this.prisma.user.delete({ where: { id } });
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          (error as { code?: string }).code === "P2025"
        ) {
          throw new NotFoundError(`user ${id} not found`);
        }
        throw error;
      }
    });
  }
}

export class PrismaProfileRepository implements ProfileRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(userId: string): Promise<Profile | null> {
    return runDb(async () => {
      const row = await this.prisma.profile.findUnique({ where: { userId } });
      return row ? profileRowToRecord(row) : null;
    });
  }

  async upsert(userId: string, profile: Profile, reason?: string): Promise<Profile> {
    return runDb(async () => {
      return this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!user) throw new NotFoundError(`user ${userId} not found`);

        const currentRow = await tx.profile.findUnique({ where: { userId } });
        const current: Profile = currentRow ? profileRowToRecord(currentRow) : {};
        const changed = changedMaterialFields(current, profile);

        const data = {
          birthDate: profile.birthDate ? new Date(`${profile.birthDate}T00:00:00.000Z`) : null,
          sex: profile.sex ?? null,
          heightCm: profile.heightCm ?? null,
          trainingExperience: profile.trainingExperience ?? null,
          trainingDaysPerWeek: profile.trainingDaysPerWeek ?? null,
          sessionDurationMinutes: profile.sessionDurationMinutes ?? null,
          limitations: [...(profile.limitations ?? [])],
          unitSystem: profile.unitSystem ?? "metric",
        };

        await tx.profile.upsert({
          where: { userId },
          create: { userId, ...data },
          update: data,
        });

        if (changed.length > 0) {
          // Append-only snapshot of the new material state (approved
          // decision 3): the history answers "what did we know then?".
          await tx.profileRevision.create({
            data: {
              id: newUuidv7(),
              userId,
              birthDate: data.birthDate,
              sex: data.sex,
              heightCm: data.heightCm,
              trainingExperience: data.trainingExperience,
              trainingDaysPerWeek: data.trainingDaysPerWeek,
              sessionDurationMinutes: data.sessionDurationMinutes,
              limitations: data.limitations,
              changedFields: [...changed],
              reason: reason ?? null,
            },
          });
        }

        const saved = await tx.profile.findUnique({ where: { userId } });
        if (!saved) throw new NotFoundError(`profile ${userId} not found after upsert`);
        return profileRowToRecord(saved);
      });
    });
  }

  async revisions(userId: string): Promise<ProfileRevisionRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.profileRevision.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
      return rows.map(revisionRowToRecord);
    });
  }
}
