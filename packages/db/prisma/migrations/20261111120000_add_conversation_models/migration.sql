-- Migration: Add AI Coach Conversation Models (Phase 9.1)
--
-- Implements conversation and conversation_message tables for the AI Coach
-- conversation persistence layer.

-- ---------------------------------------------------------------------------
-- Conversations: user-owned coaching turn transcripts
-- ---------------------------------------------------------------------------

CREATE TABLE conversations (
    id          UUID NOT NULL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CHECK constraints
ALTER TABLE conversations ADD CONSTRAINT conversations_status_check
    CHECK (status IN ('active', 'archived'));

-- Indexes
CREATE INDEX conversations_user_id_updated_at_idx ON conversations(user_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- Conversation Messages: individual turns within a conversation
-- ---------------------------------------------------------------------------

CREATE TABLE conversation_messages (
    id               UUID NOT NULL PRIMARY KEY,
    conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role             TEXT NOT NULL,
    content          TEXT NOT NULL,
    context_snapshot JSONB,
    evidence_refs    JSONB,
    proposed_actions JSONB,
    is_mock          BOOLEAN NOT NULL DEFAULT FALSE,
    provider         TEXT,
    model            TEXT,
    created_at       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CHECK constraints
ALTER TABLE conversation_messages ADD CONSTRAINT conversation_messages_role_check
    CHECK (role IN ('user', 'assistant', 'system'));

-- Indexes
CREATE INDEX conversation_messages_conversation_id_created_at_idx
    ON conversation_messages(conversation_id, created_at ASC);

-- ---------------------------------------------------------------------------
-- Helper function: updated_at trigger (reuses existing function from 0005)
-- ---------------------------------------------------------------------------

-- Function update_updated_at_column() already created in 0005_nutrient_registry
-- Just create the trigger for conversations table

CREATE TRIGGER conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
