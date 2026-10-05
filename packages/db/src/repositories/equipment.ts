import type { PrismaClient, Prisma } from "@prisma/client";
import type { CalendarDate, EquipmentCategory } from "@fitcoach/domain";
import { ConflictError, ConstraintValidationError, NotFoundError } from "../errors";
import { newUuidv7 } from "../ids";
import { toCalendarDate, toTimestamp } from "../mapping";
import { runDb } from "./util";

interface EquipmentRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface EquipmentRecord {
  id: string;
  slug: string;
  name: string;
  category: EquipmentCategory;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface UserEquipmentRow {
  id: string;
  userId: string;
  equipmentId: string;
  label: string | null;
  specifications: unknown;
  validFrom: Date;
  validTo: Date | null;
  createdAt: Date;
  updatedAt: Date;
  equipment: EquipmentRow;
}

export interface UserEquipmentRecord {
  id: string;
  userId: string;
  equipment: EquipmentRecord;
  label?: string;
  specifications?: Record<string, unknown>;
  /** User-local day this availability starts (inclusive). */
  validFrom: CalendarDate;
  /** User-local day availability ends (exclusive); absent = still available. */
  validTo?: CalendarDate;
  createdAt: string;
  updatedAt: string;
}

function equipmentRowToRecord(row: EquipmentRow): EquipmentRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category as EquipmentCategory,
    isActive: row.isActive,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

function userEquipmentRowToRecord(row: UserEquipmentRow): UserEquipmentRecord {
  return {
    id: row.id,
    userId: row.userId,
    equipment: equipmentRowToRecord(row.equipment),
    label: row.label ?? undefined,
    specifications:
      row.specifications && typeof row.specifications === "object"
        ? (row.specifications as Record<string, unknown>)
        : undefined,
    validFrom: toCalendarDate(row.validFrom),
    validTo: row.validTo ? toCalendarDate(row.validTo) : undefined,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

export interface CreateEquipmentInput {
  id?: string;
  slug: string;
  name: string;
  category: EquipmentCategory;
}

export interface AddUserEquipmentInput {
  id?: string;
  userId: string;
  equipmentId: string;
  label?: string;
  specifications?: Record<string, unknown>;
  validFrom: CalendarDate;
  validTo?: CalendarDate;
}

export interface EquipmentRepository {
  /** Catalog upsert by slug — used by the development seed (idempotent). */
  upsertCatalogItem(input: CreateEquipmentInput): Promise<EquipmentRecord>;
  findCatalogItem(id: string): Promise<EquipmentRecord | null>;
  listCatalog(): Promise<EquipmentRecord[]>;
  addUserEquipment(input: AddUserEquipmentInput): Promise<UserEquipmentRecord>;
  /**
   * The user's equipment. With `at`, answers "what did they have on that
   * day?"; without it, returns currently-open availability rows.
   */
  listUserEquipment(userId: string, at?: CalendarDate): Promise<UserEquipmentRecord[]>;
}

function parseDate(value: CalendarDate, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ConstraintValidationError(`${field} must be YYYY-MM-DD`);
  }
  return new Date(`${value}T00:00:00.000Z`);
}

export class PrismaEquipmentRepository implements EquipmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertCatalogItem(input: CreateEquipmentInput): Promise<EquipmentRecord> {
    return runDb(async () => {
      const row = await this.prisma.equipment.upsert({
        where: { slug: input.slug },
        create: {
          id: input.id ?? newUuidv7(),
          slug: input.slug,
          name: input.name,
          category: input.category,
        },
        update: { name: input.name, category: input.category },
      });
      return equipmentRowToRecord(row);
    });
  }

  async findCatalogItem(id: string): Promise<EquipmentRecord | null> {
    return runDb(async () => {
      const row = await this.prisma.equipment.findUnique({ where: { id } });
      return row ? equipmentRowToRecord(row) : null;
    });
  }

  async listCatalog(): Promise<EquipmentRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.equipment.findMany({ orderBy: { slug: "asc" } });
      return rows.map(equipmentRowToRecord);
    });
  }

  async addUserEquipment(input: AddUserEquipmentInput): Promise<UserEquipmentRecord> {
    const validFrom = parseDate(input.validFrom, "validFrom");
    const validTo = input.validTo ? parseDate(input.validTo, "validTo") : null;
    if (validTo && validTo.getTime() <= validFrom.getTime()) {
      throw new ConstraintValidationError("validTo must be after validFrom");
    }
    return runDb(async () => {
      const equipment = await this.prisma.equipment.findUnique({
        where: { id: input.equipmentId },
      });
      if (!equipment) throw new NotFoundError(`equipment ${input.equipmentId} not found`);
      const user = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true },
      });
      if (!user) throw new NotFoundError(`user ${input.userId} not found`);

      try {
        const row = await this.prisma.userEquipment.create({
          data: {
            id: input.id ?? newUuidv7(),
            userId: input.userId,
            equipmentId: input.equipmentId,
            label: input.label ?? null,
            specifications: (input.specifications ?? undefined) as Prisma.InputJsonValue | undefined,
            validFrom,
            validTo,
          },
          include: { equipment: true },
        });
        return userEquipmentRowToRecord(row);
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          (error as { code?: string }).code === "P2002"
        ) {
          throw new ConflictError(
            "equipment already registered for that user on that date",
            { cause: error },
          );
        }
        throw error;
      }
    });
  }

  async listUserEquipment(userId: string, at?: CalendarDate): Promise<UserEquipmentRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.userEquipment.findMany({
        where: {
          userId,
          ...(at
            ? {
                validFrom: { lte: parseDate(at, "at") },
                OR: [{ validTo: null }, { validTo: { gt: parseDate(at, "at") } }],
              }
            : { validTo: null }),
        },
        include: { equipment: true },
        orderBy: { validFrom: "desc" },
      });
      return rows.map(userEquipmentRowToRecord);
    });
  }
}
