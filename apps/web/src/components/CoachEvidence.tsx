import { Expandable } from "./controls";

/**
 * Renders evidence references cited by the assistant behind an expandable
 * section, keeping the main answer readable while still exposing the "why".
 *
 * Each reference shows source, code, observed value, confidence/provenance
 * and the human-readable basis. Nothing is fabricated — all fields come from
 * the backend evidence references.
 */

export function CoachEvidence({
  evidenceReferences,
  decisionContext,
}: {
  evidenceReferences: readonly { source: string; code: string; title: string; value: string; confidence: string; provenance: string; generatedAt: string; relatedEntityIds: readonly string[]; basis: string }[];
  decisionContext: { evidenceRefs: readonly { source: string; code: string; title: string; value: string; confidence: string; provenance: string; generatedAt: string; relatedEntityIds: readonly string[]; basis: string }[] };
}) {
  const refs =
    evidenceReferences.length > 0 ? evidenceReferences : decisionContext.evidenceRefs;
  if (refs.length === 0) return null;

  const bySource = new Map<string, { source: string; code: string; title: string; value: string; confidence: string; provenance: string; generatedAt: string; relatedEntityIds: readonly string[]; basis: string }[]>();
  for (const ref of refs) {
    const group = bySource.get(ref.source) ?? [];
    group.push(ref);
    bySource.set(ref.source, group);
  }

  return (
    <Expandable summary="Evidence & sources" defaultOpen={false}>
      <div className="fc-coach__evidence">
        {[...bySource.entries()].map(([source, group]) => (
          <div key={source} className="fc-coach__evidence-group">
            <p className="fc-coach__evidence-source">{source}</p>
            <ul className="fc-coach__evidence-list">
              {group.map((ref) => (
                <li key={ref.code} className="fc-coach__evidence-item">
                  <span className="fc-coach__evidence-code">{ref.code}</span>
                  <span className="fc-coach__evidence-value">{ref.value}</span>
                  <span className="fc-coach__evidence-basis">{ref.basis}</span>
                  <span className="fc-coach__evidence-meta">
                    {ref.confidence} · {ref.provenance}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Expandable>
  );
}
