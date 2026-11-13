import { useState } from "react";
import { CoachMockBadge } from "./CoachMockBadge";
import { CoachQualityBanner } from "./CoachQualityBanner";
import { CoachEvidence } from "./CoachEvidence";
import { CoachDecision } from "./CoachDecision";
import { CoachAction } from "./CoachAction";

/**
 * Renders a single conversation message.
 *
 * User messages are shown plainly. Assistant messages present the coaching
 * answer first, then evidence, decision context, quality warnings and any
 * proposed actions — with detailed evidence behind an expandable section so
 * the main answer stays readable.
 */

export function CoachMessage({
  message,
  conversationId,
}: {
  message: {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    isMock: boolean;
    provider?: string;
    model?: string;
    createdAt: string;
    contextSnapshot?: unknown;
    evidenceRefs?: unknown;
    proposedActions?: unknown;
  };
  conversationId: string;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  if (message.role === "user") {
    return (
      <div className="fc-coach__message fc-coach__message--user">
        <p className="fc-coach__message-bubble">{message.content}</p>
        <p className="fc-coach__message-time">{formatTime(message.createdAt)}</p>
      </div>
    );
  }

  if (message.role === "assistant") {
    const evidenceRefs = (message.evidenceRefs as readonly unknown[]) ?? [];
    const proposedActions = (message.proposedActions as readonly unknown[]) ?? [];

    return (
      <div className="fc-coach__message fc-coach__message--assistant">
        <div className="fc-coach__message-header">
          <span className="fc-coach__message-role">FitCoach</span>
          <CoachMockBadge isMock={message.isMock} />
          <p className="fc-coach__message-time">{formatTime(message.createdAt)}</p>
        </div>
        <p className="fc-coach__message-bubble">{message.content}</p>

        {Boolean(message.contextSnapshot) && (
          <div className="fc-coach__message-context">
            <CoachQualityBanner
              quality={
                (message.contextSnapshot as { quality: { overallScore: number; missingDataWarnings: readonly string[]; staleDataWarnings: readonly string[]; recommendedFollowUpQuestions: readonly string[]; sufficientForAdvice: boolean } })
                  .quality
              }
            />
            <CoachDecision
              decisionContext={
                (message.contextSnapshot as {
                  decision: {
                    decisionSnapshot: { id: string; kind: string; status: string; decidedAt: string; summary: string; confidence: string } | null;
                    activeInterventions: readonly string[];
                    diagnoses: readonly { code: string; title: string; severity: string }[];
                  } | undefined;
                }).decision ?? {
                  decisionSnapshot: null,
                  activeInterventions: [],
                  diagnoses: [],
                }
              }
            />
          </div>
        )}

        {evidenceRefs.length > 0 && (
          <button
            className="fc-coach__evidence-toggle"
            aria-expanded={evidenceOpen}
            onClick={() => setEvidenceOpen((o) => !o)}
          >
            {evidenceOpen ? "▸" : "▹"} Show evidence & sources
          </button>
        )}
        {evidenceOpen && (
          <CoachEvidence
            evidenceReferences={
              evidenceRefs as unknown as readonly { source: string; code: string; title: string; value: string; confidence: string; provenance: string; generatedAt: string; relatedEntityIds: readonly string[]; basis: string }[]
            }
            decisionContext={{
              evidenceRefs: (
                (message.contextSnapshot as { decision: { evidenceRefs: readonly unknown[] } | undefined }).decision
                  ?.evidenceRefs as unknown as readonly { source: string; code: string; title: string; value: string; confidence: string; provenance: string; generatedAt: string; relatedEntityIds: readonly string[]; basis: string }[]
              ),
            }}
          />
        )}

        {proposedActions.length > 0 && (
          <div className="fc-coach__actions">
            {proposedActions.map((action) => (
              <CoachAction
                key={String((action as { id: string }).id)}
                action={action as {
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
                }}
                conversationId={conversationId}
                messageId={message.id}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // system messages are informational, shown quietly
  return (
    <div className="fc-coach__message fc-coach__message--system">
      <p className="fc-coach__message-bubble fc-coach__message-bubble--system">{message.content}</p>
      <p className="fc-coach__message-time">{formatTime(message.createdAt)}</p>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
