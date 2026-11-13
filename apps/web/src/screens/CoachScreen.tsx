import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as endpoints from "../api/endpoints";
import { useAsync } from "../api/hooks";
import { useMutation } from "../api/hooks";
import type { Conversation, ConversationMessage } from "../api/types";
import { useSession } from "../session/SessionContext";
import { CoachConversationList } from "../components/CoachConversationList";
import { CoachEmpty } from "../components/CoachEmpty";
import { CoachInput } from "../components/CoachInput";
import { CoachMessage } from "../components/CoachMessage";
import { Button, StateBlock } from "../components/controls";

/**
 * AI Coach screen.
 *
 * Two views share this component:
 * - `/coach` — conversation list (or the empty state).
 * - `/coach/:conversationId` — an open conversation with message history,
 *   a compose box, and assistant responses with evidence, decision context
 *   and proposed actions.
 *
 * The backend is the source of truth for every message, evidence reference
 * and proposed action. The frontend renders what it returns and never
 * fabricates answers, evidence or metrics.
 */

export function CoachScreen() {
  const { userId } = useSession();
  const navigate = useNavigate();
  const { conversationId } = useParams<{ conversationId?: string }>();
  const [openConversationId, setOpenConversationId] = useState<string | null>(conversationId ?? null);

  // Determine which view we're in early to avoid unnecessary API calls
  const activeId = openConversationId ?? conversationId ?? null;
  const inConversation = Boolean(activeId);

  // --- Conversation list (only when not in a conversation) --------------------
  const listState = useAsync(async () => {
    if (!userId || inConversation) return { conversations: [] as Conversation[] };
    const res = await endpoints.listConversations(userId, { limit: 50 });
    return { conversations: res.conversations };
  }, [userId, inConversation]);

  // --- Open conversation messages (local state so we can append optimistically)
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !activeId) {
      setMessages([]);
      setMessagesError(null);
      return;
    }
    let cancelled = false;
    setMessagesLoading(true);
    endpoints
      .listMessages(userId, activeId, { limit: 100 })
      .then((res) => {
        if (!cancelled) setMessages(res.messages);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setMessagesError(cause instanceof Error ? cause.message : "Could not load messages.");
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, activeId]);

  // --- Send a message -------------------------------------------------------
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const sendMutation = useMutation(async (input: { message: string; asOf?: string }) => {
    if (!userId || !activeId) throw new Error("No conversation open");
    return endpoints.sendMessage(userId, activeId, input);
  });

  const handleSend = useCallback(
    async (message: string) => {
      if (!userId || !activeId) return;
      setSendError(null);
      setSending(true);
      // Optimistically add the user message so the transcript feels immediate.
      const userMessage: ConversationMessage = {
        id: `opt-${Date.now()}`,
        conversationId: activeId,
        role: "user",
        content: message,
        isMock: false,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);
      try {
        const response = await sendMutation.execute({ message, asOf: new Date().toISOString().split("T")[0] as string });
        // The API client throws on non-ok responses, so a resolved promise means 200.
        // Append the assistant message returned by the pipeline.
          const assistantMessage: ConversationMessage = {
            id: response.messageId,
            conversationId: response.conversationId,
            role: "assistant",
            content: response.answer,
            isMock: response.isMock,
            provider: "mock",
            model: "mock-local",
            createdAt: new Date().toISOString(),
            evidenceRefs: response.evidenceReferences,
            proposedActions: response.proposedActions,
            contextSnapshot: response.contextSnapshot,
          };
          setMessages((prev) => [...prev, assistantMessage]);
      } catch (cause) {
        setSendError(cause instanceof Error ? cause.message : "Could not send your message.");
        setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
      } finally {
        setSending(false);
      }
    },
    [userId, activeId, sendMutation, listState],
  );

  const handleNewConversation = useCallback(async () => {
    if (!userId) return;
    const res = await endpoints.createConversation(userId);
    setOpenConversationId(res.conversation.id);
    navigate(`/coach/${res.conversation.id}`);
  }, [userId, navigate]);

  const conversation = useMemo(
    () =>
      listState.status === "ready"
        ? listState.data.conversations.find((c) => c.id === activeId) ?? null
        : null,
    [listState, activeId],
  );

  if (!userId) {
    return (
      <div className="fc-screen fc-coach">
        <StateBlock kind="error" title="Not signed in" body="Sign in to use the AI Coach." />
      </div>
    );
  }

  // List view
  if (!inConversation) {
    return (
      <div className="fc-screen fc-coach fc-coach--list">
        <header className="fc-coach__header">
          <h1 className="fc-coach__title">FitCoach</h1>
          <p className="fc-coach__subtitle">Your coaching conversations</p>
        </header>
        {listState.status === "loading" ? (
          <StateBlock kind="loading" title="Loading conversations" />
        ) : listState.status === "error" ? (
          <StateBlock kind="error" title="Could not load conversations" body={listState.error.message} />
        ) : (
          <CoachConversationList
            conversations={listState.data.conversations}
            onNewConversation={handleNewConversation}
            onSelect={(id) => {
              setOpenConversationId(id);
              navigate(`/coach/${id}`);
            }}
            loading={false}
            error={null}
          />
        )}
      </div>
    );
  }

  return (
    <div className="fc-screen fc-coach fc-coach--conversation">
      <header className="fc-coach__header fc-coach__header--conversation">
        <Button variant="quiet" size="sm" onClick={() => {
          setOpenConversationId(null);
          navigate("/coach");
        }}>
          ← Conversations
        </Button>
        <div className="fc-coach__header-main">
          <h1 className="fc-coach__title">{conversation?.title ?? "Conversation"}</h1>
          <p className="fc-coach__subtitle">
            {(messages ?? []).length} message{(messages ?? []).length === 1 ? "" : "s"}
          </p>
        </div>
      </header>

      {messagesLoading && (messages ?? []).length === 0 ? (
        <StateBlock kind="loading" title="Loading conversation" />
      ) : messagesError ? (
        <StateBlock kind="error" title="Could not load messages" body={messagesError} />
      ) : (messages ?? []).length === 0 ? (
        <div className="fc-coach__messages">
          <CoachEmpty onNewConversation={handleNewConversation} />
        </div>
      ) : (
        <>
          <div className="fc-coach__messages">
            {messages.map((m) => (
              <CoachMessage key={m.id} message={m} conversationId={activeId!} />
            ))}
            {sendError && (
              <div className="fc-coach__message fc-coach__message--system">
                <p className="fc-coach__message-bubble fc-coach__message-bubble--system">{sendError}</p>
              </div>
            )}
          </div>
          <div className="fc-coach__compose">
            <CoachInput
              onSend={handleSend}
              disabled={sending}
              placeholder="Ask FitCoach about your training, nutrition, recovery or progress…"
            />
            {sending && <span className="fc-coach__sending">FitCoach is thinking…</span>}
          </div>
        </>
      )}
    </div>
  );
}
