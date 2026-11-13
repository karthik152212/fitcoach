import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  ConversationId,
  ConversationStatus,
  MessageId,
  MessageRole,
  Timestamp,
  UserId,
} from "@fitcoach/domain";
import { newUuidv7 } from "../ids";
import { toTimestamp } from "../mapping";
import { boundedLimit, runDb } from "./util";

// ---------------------------------------------------------------------------
// Domain record types — mirror the @fitcoach/domain conversation entity types,
// persisted via Prisma. JSON columns are typed as unknown here; the service
// layer casts them to the typed contracts from @fitcoach/ai.
// ---------------------------------------------------------------------------

export interface ConversationRecord {
  id: ConversationId;
  userId: UserId;
  title?: string;
  status: ConversationStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ConversationMessageRecord {
  id: MessageId;
  conversationId: ConversationId;
  role: MessageRole;
  content: string;
  contextSnapshot?: unknown;
  evidenceRefs?: unknown;
  proposedActions?: unknown;
  isMock: boolean;
  provider?: string;
  model?: string;
  createdAt: Timestamp;
}

export interface CreateConversationInput {
  id?: ConversationId;
  userId: UserId;
  title?: string;
  status?: ConversationStatus;
}

export interface CreateMessageInput {
  id?: MessageId;
  conversationId: ConversationId;
  role: MessageRole;
  content: string;
  contextSnapshot?: unknown;
  evidenceRefs?: unknown;
  proposedActions?: unknown;
  isMock?: boolean;
  provider?: string;
  model?: string;
}

export interface ListConversationsOptions {
  status?: ConversationStatus;
  limit?: number;
  cursor?: string;
}

export interface ListMessagesOptions {
  limit?: number;
  cursor?: string;
}

// ---------------------------------------------------------------------------
// Conversation repository
// ---------------------------------------------------------------------------

interface ConversationRow {
  id: string;
  userId: string;
  title: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export function conversationRowToRecord(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title ?? undefined,
    status: row.status as ConversationStatus,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

export interface ConversationRepository {
  create(input: CreateConversationInput): Promise<ConversationRecord>;
  findById(id: ConversationId): Promise<ConversationRecord | null>;
  list(
    userId: UserId,
    options?: ListConversationsOptions,
  ): Promise<ConversationRecord[]>;
  updateStatus(id: ConversationId, status: ConversationStatus): Promise<ConversationRecord>;
}

export class PrismaConversationRepository implements ConversationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async load(id: string): Promise<ConversationRecord | null> {
    const row = await this.prisma.conversation.findUnique({
      where: { id },
    });
    return row ? conversationRowToRecord(row) : null;
  }

  async create(input: CreateConversationInput): Promise<ConversationRecord> {
    const id = input.id ?? newUuidv7();
    return runDb(async () => {
      const row = await this.prisma.conversation.create({
        data: {
          id,
          userId: input.userId,
          title: input.title ?? null,
          status: input.status ?? "active",
        },
      });
      return conversationRowToRecord(row);
    });
  }

  async findById(id: ConversationId): Promise<ConversationRecord | null> {
    return runDb(() => this.load(id));
  }

  async list(
    userId: UserId,
    options: ListConversationsOptions = {},
  ): Promise<ConversationRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.conversation.findMany({
        where: {
          userId,
          ...(options.status ? { status: options.status } : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: boundedLimit(options.limit, 50),
        ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      });
      return rows.map(conversationRowToRecord);
    });
  }

  async updateStatus(
    id: ConversationId,
    status: ConversationStatus,
  ): Promise<ConversationRecord> {
    return runDb(async () => {
      const row = await this.prisma.conversation.update({
        where: { id },
        data: { status },
      });
      return conversationRowToRecord(row);
    });
  }
}

// ---------------------------------------------------------------------------
// Conversation message repository
// ---------------------------------------------------------------------------

interface MessageRow {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  contextSnapshot: unknown;
  evidenceRefs: unknown;
  proposedActions: unknown;
  isMock: boolean;
  provider: string | null;
  model: string | null;
  createdAt: Date;
}

export function messageRowToRecord(row: MessageRow): ConversationMessageRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as MessageRole,
    content: row.content,
    contextSnapshot: row.contextSnapshot,
    evidenceRefs: row.evidenceRefs,
    proposedActions: row.proposedActions,
    isMock: row.isMock,
    provider: row.provider ?? undefined,
    model: row.model ?? undefined,
    createdAt: toTimestamp(row.createdAt),
  };
}

export interface ConversationMessageRepository {
  create(input: CreateMessageInput): Promise<ConversationMessageRecord>;
  findById(id: MessageId): Promise<ConversationMessageRecord | null>;
  list(
    conversationId: ConversationId,
    options?: ListMessagesOptions,
  ): Promise<ConversationMessageRecord[]>;
  listByUser(
    userId: UserId,
    options?: { limit?: number; cursor?: string },
  ): Promise<{ conversationId: ConversationId; messages: ConversationMessageRecord[] }[]>;
}

export class PrismaConversationMessageRepository
  implements ConversationMessageRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  private async load(id: string): Promise<ConversationMessageRecord | null> {
    const row = await this.prisma.conversationMessage.findUnique({
      where: { id },
    });
    return row ? messageRowToRecord(row) : null;
  }

  async create(input: CreateMessageInput): Promise<ConversationMessageRecord> {
    const id = input.id ?? newUuidv7();
    return runDb(async () => {
      const row = await this.prisma.conversationMessage.create({
        data: {
          id,
          conversationId: input.conversationId,
          role: input.role,
          content: input.content,
          contextSnapshot: (input.contextSnapshot ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
          evidenceRefs: (input.evidenceRefs ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
          proposedActions: (input.proposedActions ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
          isMock: input.isMock ?? false,
          provider: input.provider ?? null,
          model: input.model ?? null,
        },
      });
      return messageRowToRecord(row);
    });
  }

  async findById(id: MessageId): Promise<ConversationMessageRecord | null> {
    return runDb(() => this.load(id));
  }

  async list(
    conversationId: ConversationId,
    options: ListMessagesOptions = {},
  ): Promise<ConversationMessageRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.conversationMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: "asc" },
        take: boundedLimit(options.limit, 100),
        ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      });
      return rows.map(messageRowToRecord);
    });
  }

  async listByUser(
    userId: UserId,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<{
    conversationId: ConversationId;
    messages: ConversationMessageRecord[];
  }[]> {
    return runDb(async () => {
      const conversations = await this.prisma.conversation.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: boundedLimit(options.limit, 20),
        ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
            take: 50,
          },
        },
      });

      return conversations.map((c) => ({
        conversationId: c.id,
        messages: c.messages.map(messageRowToRecord),
      }));
    });
  }
}
