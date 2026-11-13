import { useNavigate } from "react-router-dom";
import { Button, Chip, StateBlock } from "./controls";

/**
 * Lists the user's conversations (most recently updated first) and offers a
 * "New conversation" action. Clicking a conversation opens it.
 */

export function CoachConversationList({
  conversations,
  onNewConversation,
  onSelect,
  loading,
  error,
}: {
  conversations: readonly { id: string; title?: string; status: string; updatedAt: string }[];
  onNewConversation: () => void;
  onSelect: (conversationId: string) => void;
  loading?: boolean;
  error?: string | null;
}) {
  const navigate = useNavigate();

  if (loading) return <StateBlock kind="loading" title="Loading conversations" />;
  if (error) {
    return (
      <StateBlock
        kind="error"
        title="Could not load conversations"
        body={error}
        action={<Button onClick={() => navigate("/coach")}>Retry</Button>}
      />
    );
  }

  return (
    <div className="fc-coach__list">
      <div className="fc-coach__list-header">
        <span className="fc-coach__list-title">Conversations</span>
        <Button variant="primary" size="sm" onClick={onNewConversation}>
          New conversation
        </Button>
      </div>
      {conversations.length === 0 ? (
        <p className="fc-coach__list-empty">
          No conversations yet. Start one to talk with FitCoach.
        </p>
      ) : (
        <ul className="fc-coach__list-items">
          {conversations.map((c) => (
            <li key={c.id} className="fc-coach__list-item">
              <button
                className="fc-coach__list-button"
                onClick={() => onSelect(c.id)}
                aria-label={c.title ?? "Untitled conversation"}
              >
                <span className="fc-coach__list-title">{c.title ?? "Untitled conversation"}</span>
                <span className="fc-coach__list-time">
                  {new Date(c.updatedAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                </span>
                <Chip tone="neutral" size="sm">{c.status}</Chip>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
