import { Button } from "./controls";

/**
 * Empty state when there are no conversations — invites the user to start.
 */

export function CoachEmpty({ onNewConversation }: { onNewConversation: () => void }) {
  return (
    <div className="fc-coach__empty">
      <div className="fc-coach__empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2Z" />
          <path d="M20 16a4 4 0 0 1-4 4h0a4 4 0 0 1-4-4h0a4 4 0 0 1 4-4h0a4 4 0 0 1 4 4Z" />
        </svg>
      </div>
      <h2 className="fc-coach__empty-title">Start a conversation</h2>
      <p className="fc-coach__empty-body">
        Ask FitCoach about your training, nutrition, recovery or progress.
        Every answer is grounded in your own FitCoach data.
      </p>
      <Button variant="primary" size="large" full onClick={onNewConversation}>
        New conversation
      </Button>
    </div>
  );
}
