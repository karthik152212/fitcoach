# ai

AI orchestration layer. **The AI is not the source of truth.** Everything it says
must trace back to a deterministic fact computed by `fitness-core` or
`nutrition`.

Current state: contracts only — no SDK or provider integration exists yet.

## The boundary

| Deterministic systems own (never the LLM) | This layer may do |
|---|---|
| nutrition, macro, fat-detail, fiber and activity totals | parse natural-language input into structured candidates |
| measurement trends and physique metrics | interpret validated facts |
| training volume, stimulus, recovery, progression | explain results and why a recommendation was made |
| projection inputs, ranges, assumptions | present recommendations and no-change states |
| constraints, evidence rows, diagnosis candidates | ask clarifying questions when data is missing |
| uncertainty and confidence | communicate uncertainty and trade-offs |
| | summarise progress across domains |

The AI must never invent a measurement, calorie, nutrient value, exercise
availability, training history or diagnosis. It must never write to domain
tables directly; it proposes, deterministic code decides and persists.

## Planned capabilities

| Capability | Phase | Notes |
|---|---|---|
| natural-language food entry | 9 | produces `MealItem` candidates for user confirmation; never silently accepted |
| natural-language workout entry | 9 | same pattern: candidates, then confirmation |
| explanations of findings | 9 | cites the persisted evidence rows it is explaining |
| recommendation presentation | 9 | includes rationale, expected effect and review date |
| uncertainty communication | 9 | says "estimated, range X–Y" instead of implying precision |
| clarifying questions | 9 | asks when required data is missing rather than assuming |
| progress summaries | 9 | aggregation over domain summaries; no new facts |

Computer-vision food recognition and photo-derived portions are **later**, and
behind the photo-assisted estimate contract (`docs/DATABASE_DESIGN.md` §23.2).

## Evidence rule

A recommendation is only ever presented from a persisted chain:

```text
OBSERVATIONS → DERIVED FACTS → EVIDENCE → DIAGNOSIS → RECOMMENDATION
  → INTERVENTION → OUTCOME → FOLLOW-UP
```

The conversation transcript is **not** the record of why something was
recommended. If the chain cannot be reconstructed from stored evidence, the
recommendation is not made.

## Data handling

- Raw AI conversations are not persisted by default; only the structured output
  the user actually sees (recommendation, explanation, confirmed edits).
- Health data from prompts is subject to the same privacy boundaries as the rest
  of the product (`docs/ARCHITECTURE.md` §13): minimum necessary storage,
  explicit provenance, user deletion.
- Provider selection, retention settings and consent model are an open design
  question (Q7 in `docs/DATABASE_DESIGN.md` §22) to be settled before any
  provider is integrated.