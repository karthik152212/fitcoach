import { useState } from "react";
import { Button, Input } from "./controls";

/**
 * Message input: sends the current draft on Enter or the send button.
 * Empty submits are ignored; the input clears after a successful send.
 */

export function CoachInput({
  onSend,
  disabled = false,
  placeholder = "Ask FitCoach…",
}: {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    const message = draft.trim();
    if (!message || disabled) return;
    onSend(message);
    setDraft("");
  };

  return (
    <div className="fc-coach__input">
      <Input
        multiline
        rows={2}
        value={draft}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => setDraft(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
      />
      <Button variant="primary" size="sm" onClick={handleSend} disabled={disabled || draft.trim().length === 0}>
        Send
      </Button>
    </div>
  );
}
