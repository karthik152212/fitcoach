# nutrition

Deterministic nutrition logic: foods, nutrients, recipes, meals, daily totals,
targets and trends. No I/O, no persistence, no clock, no LLM.

Natural-language parsing belongs in the AI/application layer; **validated
nutrition calculations belong here**. The AI proposes candidates, this package
decides what they mean.

Current state: `snapshot.ts` is implemented and tested. The remaining modules are
typed boundaries whose functions throw `NotImplementedError` — they deliberately
do not pretend to work.

## Implemented

| Module | Purpose |
|---|---|
| `snapshot` | write-time nutrient arithmetic: scale per-100 g/ml density, sum meal items, divide a recipe batch into per-serving or per-gram values |

`snapshot` is driven by the **nutrient set**, not a fixed list of fields: fat
detail (saturated/mono/poly/trans, omega-3/6), cholesterol and the
`additionalNutrients` micronutrient bag scale, sum and divide like any other
nutrient, and an undeclared nutrient stays `undefined` instead of becoming `0`.

## Planned modules

| Module | Phase | Purpose |
|---|---|---|
| `normalization` | 4 | canonicalize raw food names/units into reference candidates |
| `servingConversion` | 4 | servings ⇄ grams ⇄ millilitres, from density basis and serving definitions |
| `mealTotals` / `dailyTotals` | 4 | totals over the extended nutrient set, snapshot-consistent |
| `targets` | 4 | per-person nutrient targets with basis and confidence — never universal constants |
| `trends` | 4 | rolling/weekly nutrition trends and adherence |
| `confidence` | 4 | combining per-value confidence into a usable "how much do we trust this" |
| `uncertainty` | 4 | ranges for estimated quantities and derived values |
| `recipes` | 4 | recipe yield, per-serving and per-gram resolution, recipe versioning |
| `foodInputs/search` | 4 | search over the catalog (Phase 1 catalog + Phase 4 imports) |
| `foodInputs/naturalLanguage` | 9 | parse a text description into structured `MealItem` candidates for user confirmation |
| `foodInputs/photoAssisted` | later | fold estimated candidates/portions with ranges + confidence into items |

## Rules

1. **Absence is unknown, not zero.** A nutrient nobody published stays
   `undefined` through scale → sum → divide and is stored as NULL.
2. **Snapshots are point-in-time.** Nutrient values used at logging time are
   frozen into meal items; later edits to a food or recipe cannot rewrite history.
3. **Food identity includes state.** Raw vs cooked, preparation method, recipe,
   brand and serving all change what a food is; "100 g chicken curry" is never a
   single universal record.
4. **Precision follows provenance.** Label-declared, measured, estimated and
   AI-parsed values are distinguishable, and photo-derived quantities carry a
   range plus confidence instead of fake grams.
5. **Targets are contextual.** Every target states how it was derived
   (`NutritionTargets.basisNote`) and is specific to the person and their goal.