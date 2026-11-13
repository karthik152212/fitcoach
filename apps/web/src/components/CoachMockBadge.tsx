/**
 * Clearly labels responses produced by the mock AI provider.
 *
 * The current backend uses MockAIProvider, which requires no API key and makes
 * no external calls. This badge keeps that transparent so the user never
 * mistakes a mock response for a production model. Kept provider-independent so
 * a future real provider can simply stop rendering it.
 */

export function CoachMockBadge({ isMock }: { isMock: boolean }) {
  if (!isMock) return null;
  return (
    <span className="fc-coach__mock-badge" title="Mock AI response — no external model, no API key">
      <span className="fc-coach__mock-dot" aria-hidden="true" />
      Mock AI response
    </span>
  );
}
