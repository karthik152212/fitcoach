import type {
  EquipmentRepository,
  GoalRepository,
  GoalRecord,
  ProfileRepository,
  UserRepository,
} from "@fitcoach/db";
import { NotFoundError } from "@fitcoach/db";
import type {
  CalendarDate,
  EquipmentCategory,
  GoalKind,
  PhysiqueTarget,
  Profile,
  User,
} from "@fitcoach/domain";
import { toUserLocalDate } from "@fitcoach/domain";

/**
 * Identity, profile, goal and equipment services.
 *
 * Services own use-case rules (timezone-derived defaults, point-in-time
 * equipment views, active-goal resolution); routes own request parsing.
 * Every service receives its repositories by injection (milestone §10).
 */

export interface CreateUserCommand {
  id?: string;
  email?: string;
  displayName?: string;
  timezone?: string;
  externalAuthId?: string;
}

export interface CreateGoalCommand {
  id?: string;
  kind: GoalKind;
  description?: string;
  effectiveFrom?: CalendarDate;
  priorities?: readonly string[];
  physiqueTarget?: PhysiqueTarget;
}

export interface AddEquipmentCommand {
  id?: string;
  equipmentId: string;
  label?: string;
  specifications?: Record<string, unknown>;
  validFrom?: CalendarDate;
  validTo?: CalendarDate;
}

export class UserService {
  constructor(private readonly users: UserRepository) {}

  create(command: CreateUserCommand): Promise<User> {
    return this.users.create(command);
  }

  async get(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError(`user ${userId} not found`);
    return user;
  }

  update(
    userId: string,
    patch: { email?: string; displayName?: string; timezone?: string },
  ): Promise<User> {
    return this.users.update(userId, patch);
  }

  /** Local "today" for a user — every daily concept starts here. */
  async localToday(userId: string): Promise<CalendarDate> {
    const user = await this.get(userId);
    return toUserLocalDate(new Date(), user.timezone);
  }
}

export class ProfileService {
  constructor(private readonly profiles: ProfileRepository) {}

  async get(userId: string): Promise<Profile> {
    return (await this.profiles.get(userId)) ?? {};
  }

  upsert(userId: string, profile: Profile, reason?: string): Promise<Profile> {
    return this.profiles.upsert(userId, profile, reason);
  }

  revisions(userId: string) {
    return this.profiles.revisions(userId);
  }
}

export class GoalService {
  constructor(private readonly goals: GoalRepository) {}

  create(userId: string, command: CreateGoalCommand, defaultEffectiveFrom: CalendarDate): Promise<GoalRecord> {
    return this.goals.create({
      ...(command.id ? { id: command.id } : {}),
      userId,
      kind: command.kind,
      ...(command.description !== undefined ? { description: command.description } : {}),
      effectiveFrom: command.effectiveFrom ?? defaultEffectiveFrom,
      ...(command.priorities ? { priorities: command.priorities } : {}),
      ...(command.physiqueTarget ? { physiqueTarget: command.physiqueTarget } : {}),
    });
  }

  active(userId: string): Promise<GoalRecord | null> {
    return this.goals.active(userId);
  }

  history(userId: string): Promise<GoalRecord[]> {
    return this.goals.history(userId);
  }
}

export class EquipmentService {
  constructor(
    private readonly equipment: EquipmentRepository,
    private readonly users: UserRepository,
  ) {}

  private async today(userId: string): Promise<CalendarDate> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError(`user ${userId} not found`);
    return toUserLocalDate(new Date(), user.timezone);
  }

  async add(userId: string, command: AddEquipmentCommand) {
    const validFrom = command.validFrom ?? (await this.today(userId));
    return this.equipment.addUserEquipment({
      ...(command.id ? { id: command.id } : {}),
      userId,
      equipmentId: command.equipmentId,
      ...(command.label !== undefined ? { label: command.label } : {}),
      ...(command.specifications ? { specifications: command.specifications } : {}),
      validFrom,
      ...(command.validTo ? { validTo: command.validTo } : {}),
    });
  }

  async list(userId: string, at?: CalendarDate) {
    // Ensure the user exists even when listing without an explicit date.
    await this.today(userId);
    return this.equipment.listUserEquipment(userId, at);
  }

  addCatalogItem(input: { id?: string; slug: string; name: string; category: EquipmentCategory }) {
    return this.equipment.upsertCatalogItem(input);
  }
}
