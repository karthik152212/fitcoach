import { useState } from "react";
import { Button, Chip, StateBlock } from "./controls";
import {
  confirmAction,
  previewAction,
  rejectAction,
} from "../api/endpoints";
import { useSession } from "../session/SessionContext";
import { useMutation } from "../api/hooks";

/**
 * Presents a single proposed action and manages its preview → confirm/reject
 * lifecycle. No action is executed without explicit user confirmation, and a
 * rejected or executed action cannot be re-submitted.
 */

export function CoachAction({
  action,
  conversationId,
  messageId,
}: {
  action: {
    id: string;
    kind: string;
    title: string;
    description: string;
    domainService: string;
    parameters: Record<string, string | number | boolean | null>;
    requiresConfirmation: boolean;
    validated: boolean;
    evidenceRefs: readonly { source: string; code: string; title: string; value: string }[];
    status: "pending" | "confirmed" | "rejected" | "executed";
  };
  conversationId: string;
  messageId: string;
}) {
  const { userId } = useSession();
  const [stage, setStage] = useState<"idle" | "preview" | "confirming" | "done">("idle");
  const [preview, setPreview] = useState<{ validation: { valid: boolean; errors: string[] }; preview: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"executed" | "rejected" | null>(null);

  const confirm = useMutation(async () => {
    if (!userId) throw new Error("No user signed in");
    return confirmAction(userId, conversationId, messageId, action.id);
  });
  const reject = useMutation(async () => {
    if (!userId) throw new Error("No user signed in");
    return rejectAction(userId, conversationId, messageId, action.id);
  });

  const resolvedStatus = outcome ?? action.status;
  const isResolved = resolvedStatus === "confirmed" || resolvedStatus === "rejected" || resolvedStatus === "executed";

  // Non-executable actions (backend returns failure) are presented honestly:
  // no fake confirmation button.
  const notExecutable = !action.requiresConfirmation && action.domainService.includes("not directly executable");

  if (isResolved) {
    const label =
      resolvedStatus === "executed" ? "Done" : resolvedStatus === "rejected" ? "Rejected" : "Confirmed";
    const tone = resolvedStatus === "executed" ? "success" : "neutral";
    return (
      <div className={`fc-coach__action fc-coach__action--resolved fc-coach__action--${resolvedStatus}`}>
        <Chip tone={tone} size="sm">{label}</Chip>
        <span className="fc-coach__action-title">{action.title}</span>
        <p className="fc-coach__action-body">{action.description}</p>
        {resolvedStatus === "executed" && preview?.preview && (
          <p className="fc-coach__action-result">{preview.preview}</p>
        )}
        {outcome === "executed" && (
          <p className="fc-coach__action-result">Action applied.</p>
        )}
      </div>
    );
  }

  if (notExecutable) {
    return (
      <div className="fc-coach__action fc-coach__action--not-executable">
        <Chip tone="important" size="sm">Not directly executable</Chip>
        <span className="fc-coach__action-title">{action.title}</span>
        <p className="fc-coach__action-body">{action.description}</p>
        <p className="fc-coach__action-note">
          This action must go through its own workflow before it can be applied.
        </p>
      </div>
    );
  }

  const handlePreview = async () => {
    if (!userId) return;
    setError(null);
    try {
      const res = await previewAction(userId, conversationId, messageId, action.id);
      setPreview(res.preview);
      setStage("preview");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Preview failed.");
    }
  };

  const handleConfirm = async () => {
    setStage("confirming");
    try {
      await confirm.execute();
      setOutcome("executed");
      setStage("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not confirm the action.");
      setStage("idle");
    }
  };

  const handleReject = async () => {
    try {
      await reject.execute();
      setOutcome("rejected");
      setStage("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reject the action.");
    }
  };

  return (
    <div className="fc-coach__action fc-coach__action--pending">
      <Chip tone="accent" size="sm">Action</Chip>
      <span className="fc-coach__action-title">{action.title}</span>
      <p className="fc-coach__action-body">{action.description}</p>

      {stage === "idle" && (
        <Button variant="outline" size="sm" onClick={handlePreview} disabled={confirm.pending || reject.pending}>
          Preview
        </Button>
      )}

      {stage === "preview" && (
        <div className="fc-coach__action-preview">
          <p className="fc-coach__preview-summary">{preview?.preview ?? "Reviewing action…"}</p>
          {preview && !preview.validation.valid && (
            <p className="fc-coach__preview-error">
              Validation: {preview.validation.errors.join("; ")}
            </p>
          )}
          <div className="fc-coach__action-preview-actions">
            <Button variant="primary" size="sm" onClick={handleConfirm} disabled={confirm.pending || reject.pending || !preview?.validation.valid}>
              Confirm
            </Button>
            <Button variant="quiet" size="sm" onClick={handleReject} disabled={confirm.pending || reject.pending}>
              Reject
            </Button>
          </div>
        </div>
      )}

      {stage === "confirming" && (
        <StateBlock kind="loading" title="Confirming action…" />
      )}

      {stage === "done" && error === null && (
        <p className="fc-coach__action-result">Action applied.</p>
      )}

      {error && (
        <StateBlock kind="error" title={error} action={<Button variant="quiet" size="sm" onClick={() => setStage("idle")}>Try again</Button>} />
      )}
    </div>
  );
}
