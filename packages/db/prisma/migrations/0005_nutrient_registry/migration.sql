-- Migration 0005: Nutrient Registry (Phase 4 Nutrition V2)
--
-- Implements docs/DATABASE_DESIGN.md §V2 review: nutrient_definitions + food_nutrient_values
-- Replaces flat nutrient columns on foods with a flexible, provenance-aware registry.
-- Existing foods.nutrients_* columns remain for backwards compatibility; new data
-- should use the registry. A future migration will deprecate the flat columns.

-- ---------------------------------------------------------------------------
-- Nutrient Definitions: canonical registry of all known nutrients
-- ---------------------------------------------------------------------------

CREATE TABLE nutrient_definitions (
    id              UUID NOT NULL PRIMARY KEY,
    -- Stable machine key, e.g. 'calories_kcal', 'vitamin_d', 'iron_mg'
    key             TEXT NOT NULL UNIQUE,
    -- Human-readable name for UI
    display_name    TEXT NOT NULL,
    -- Canonical unit: 'kcal' | 'kj' | 'g' | 'mg' | 'mcg' | 'iu'
    unit            TEXT NOT NULL,
    -- Category for grouping in UI: 'energy' | 'macronutrient' | 'fiber' | 'sugar' |
    -- 'fat_detail' | 'mineral' | 'vitamin' | 'amino_acid' | 'other'
    category        TEXT NOT NULL,
    -- Default display precision (decimal places)
    precision       SMALLINT NOT NULL DEFAULT 2,
    -- Reference daily intake (RDI) for %DV calculations, when established
    rdi_value       NUMERIC(12, 4),
    rdi_unit        TEXT,
    -- Ordering in nutrient lists
    sort_order      SMALLINT NOT NULL DEFAULT 0,
    -- Source this definition came from (for audit)
    source_id       UUID REFERENCES external_sources(id) ON DELETE SET NULL,
    -- Whether this is a core nutrient (always present in foods table snapshot)
    is_core         BOOLEAN NOT NULL DEFAULT FALSE,
    -- Active flag (retired, never deleted)
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,

    created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CHECK constraints
ALTER TABLE nutrient_definitions ADD CONSTRAINT nutrient_definitions_unit_check
    CHECK (unit IN ('kcal', 'kj', 'g', 'mg', 'mcg', 'iu'));

ALTER TABLE nutrient_definitions ADD CONSTRAINT nutrient_definitions_category_check
    CHECK (category IN ('energy', 'macronutrient', 'fiber', 'sugar', 'fat_detail', 'mineral', 'vitamin', 'amino_acid', 'other'));

-- Indexes
CREATE INDEX nutrient_definitions_category_idx ON nutrient_definitions(category);
CREATE INDEX nutrient_definitions_is_core_idx ON nutrient_definitions(is_core);
CREATE INDEX nutrient_definitions_sort_order_idx ON nutrient_definitions(sort_order);

-- ---------------------------------------------------------------------------
-- Food Nutrient Values: per-food nutrient data with full provenance
-- ---------------------------------------------------------------------------

CREATE TABLE food_nutrient_values (
    id                  UUID NOT NULL PRIMARY KEY,
    food_id             UUID NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
    nutrient_id         UUID NOT NULL REFERENCES nutrient_definitions(id) ON DELETE RESTRICT,
    -- Amount per 100g (or per 100ml for density_basis = 'per_100ml')
    amount_per_100      NUMERIC(12, 4) NOT NULL,
    -- Confidence in this value
    confidence          TEXT NOT NULL,
    -- Provenance tier
    provenance_tier     TEXT NOT NULL,
    -- Preparation state this value applies to
    preparation_state   TEXT,
    -- Preparation method detail
    preparation_method  TEXT,
    -- Optional uncertainty range for estimates
    uncertainty_low     NUMERIC(12, 4),
    uncertainty_high    NUMERIC(12, 4),
    -- Source dataset row identifier
    external_id         TEXT,
    -- When this value was measured/recorded
    measured_at         TIMESTAMPTZ(6),
    -- Notes from the data source
    notes               TEXT,

    created_at          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- One value per food per nutrient per preparation state (partial unique in SQL)
    UNIQUE (food_id, nutrient_id, preparation_state)
);

-- CHECK constraints
ALTER TABLE food_nutrient_values ADD CONSTRAINT food_nutrient_values_confidence_check
    CHECK (confidence IN ('measured', 'label_declared', 'estimated', 'unknown'));

ALTER TABLE food_nutrient_values ADD CONSTRAINT food_nutrient_values_provenance_tier_check
    CHECK (provenance_tier IN ('first_party', 'verified_external', 'branded', 'restaurant', 'user_created', 'photo_derived_estimate', 'ai_parsed'));

ALTER TABLE food_nutrient_values ADD CONSTRAINT food_nutrient_values_preparation_state_check
    CHECK (preparation_state IN ('raw', 'cooked', 'unprepared', 'prepared', 'unknown') OR preparation_state IS NULL);

-- Indexes
CREATE INDEX food_nutrient_values_food_id_idx ON food_nutrient_values(food_id);
CREATE INDEX food_nutrient_values_nutrient_id_idx ON food_nutrient_values(nutrient_id);
CREATE INDEX food_nutrient_values_provenance_tier_idx ON food_nutrient_values(provenance_tier);

-- ---------------------------------------------------------------------------
-- Seed core nutrient definitions
-- ---------------------------------------------------------------------------

INSERT INTO nutrient_definitions (id, key, display_name, unit, category, precision, rdi_value, rdi_unit, sort_order, is_core, is_active) VALUES
    (gen_random_uuid(), 'calories_kcal', 'Energy', 'kcal', 'energy', 0, 2000, 'kcal', 0, TRUE, TRUE),
    (gen_random_uuid(), 'calories_kj', 'Energy', 'kj', 'energy', 0, 8370, 'kj', 1, FALSE, TRUE),
    (gen_random_uuid(), 'protein_grams', 'Protein', 'g', 'macronutrient', 1, 50, 'g', 10, TRUE, TRUE),
    (gen_random_uuid(), 'carbohydrate_grams', 'Carbohydrate', 'g', 'macronutrient', 1, 275, 'g', 20, TRUE, TRUE),
    (gen_random_uuid(), 'fat_grams', 'Total Fat', 'g', 'macronutrient', 1, 78, 'g', 30, TRUE, TRUE),
    (gen_random_uuid(), 'fiber_grams', 'Dietary Fiber', 'g', 'fiber', 1, 28, 'g', 40, TRUE, TRUE),
    (gen_random_uuid(), 'sugars_grams', 'Total Sugars', 'g', 'sugar', 1, NULL, NULL, 50, TRUE, TRUE),
    -- Fat detail
    (gen_random_uuid(), 'saturated_fat_grams', 'Saturated Fat', 'g', 'fat_detail', 1, 20, 'g', 60, TRUE, TRUE),
    (gen_random_uuid(), 'monounsaturated_fat_grams', 'Monounsaturated Fat', 'g', 'fat_detail', 1, NULL, NULL, 61, FALSE, TRUE),
    (gen_random_uuid(), 'polyunsaturated_fat_grams', 'Polyunsaturated Fat', 'g', 'fat_detail', 1, NULL, NULL, 62, FALSE, TRUE),
    (gen_random_uuid(), 'trans_fat_grams', 'Trans Fat', 'g', 'fat_detail', 1, NULL, NULL, 63, TRUE, TRUE),
    (gen_random_uuid(), 'omega3_grams', 'Omega-3 Fatty Acids', 'g', 'fat_detail', 3, 1.6, 'g', 64, FALSE, TRUE),
    (gen_random_uuid(), 'omega6_grams', 'Omega-6 Fatty Acids', 'g', 'fat_detail', 3, 17, 'g', 65, FALSE, TRUE),
    -- Minerals
    (gen_random_uuid(), 'sodium_mg', 'Sodium', 'mg', 'mineral', 0, 2300, 'mg', 70, TRUE, TRUE),
    (gen_random_uuid(), 'potassium_mg', 'Potassium', 'mg', 'mineral', 0, 4700, 'mg', 71, FALSE, TRUE),
    (gen_random_uuid(), 'calcium_mg', 'Calcium', 'mg', 'mineral', 0, 1300, 'mg', 72, FALSE, TRUE),
    (gen_random_uuid(), 'iron_mg', 'Iron', 'mg', 'mineral', 1, 18, 'mg', 73, FALSE, TRUE),
    (gen_random_uuid(), 'magnesium_mg', 'Magnesium', 'mg', 'mineral', 0, 420, 'mg', 74, FALSE, TRUE),
    (gen_random_uuid(), 'zinc_mg', 'Zinc', 'mg', 'mineral', 1, 11, 'mg', 75, FALSE, TRUE),
    (gen_random_uuid(), 'copper_mg', 'Copper', 'mg', 'mineral', 3, 0.9, 'mg', 76, FALSE, TRUE),
    (gen_random_uuid(), 'manganese_mg', 'Manganese', 'mg', 'mineral', 1, 2.3, 'mg', 77, FALSE, TRUE),
    (gen_random_uuid(), 'selenium_mcg', 'Selenium', 'mcg', 'mineral', 0, 55, 'mcg', 78, FALSE, TRUE),
    -- Vitamins
    (gen_random_uuid(), 'vitamin_a_mcg_rae', 'Vitamin A (RAE)', 'mcg', 'vitamin', 0, 900, 'mcg', 80, FALSE, TRUE),
    (gen_random_uuid(), 'vitamin_c_mg', 'Vitamin C', 'mg', 'vitamin', 0, 90, 'mg', 81, FALSE, TRUE),
    (gen_random_uuid(), 'vitamin_d_mcg', 'Vitamin D', 'mcg', 'vitamin', 1, 20, 'mcg', 82, FALSE, TRUE),
    (gen_random_uuid(), 'vitamin_e_mg', 'Vitamin E', 'mg', 'vitamin', 1, 15, 'mg', 83, FALSE, TRUE),
    (gen_random_uuid(), 'vitamin_k_mcg', 'Vitamin K', 'mcg', 'vitamin', 0, 120, 'mcg', 84, FALSE, TRUE),
    (gen_random_uuid(), 'thiamin_mg', 'Thiamin (B1)', 'mg', 'vitamin', 2, 1.2, 'mg', 85, FALSE, TRUE),
    (gen_random_uuid(), 'riboflavin_mg', 'Riboflavin (B2)', 'mg', 'vitamin', 2, 1.3, 'mg', 86, FALSE, TRUE),
    (gen_random_uuid(), 'niacin_mg', 'Niacin (B3)', 'mg', 'vitamin', 1, 16, 'mg', 87, FALSE, TRUE),
    (gen_random_uuid(), 'vitamin_b6_mg', 'Vitamin B6', 'mg', 'vitamin', 2, 1.7, 'mg', 88, FALSE, TRUE),
    (gen_random_uuid(), 'folate_mcg_dfe', 'Folate (DFE)', 'mcg', 'vitamin', 0, 400, 'mcg', 89, FALSE, TRUE),
    (gen_random_uuid(), 'vitamin_b12_mcg', 'Vitamin B12', 'mcg', 'vitamin', 2, 2.4, 'mcg', 90, FALSE, TRUE),
    (gen_random_uuid(), 'choline_mg', 'Choline', 'mg', 'vitamin', 0, 550, 'mg', 91, FALSE, TRUE),
    -- Other
    (gen_random_uuid(), 'cholesterol_mg', 'Cholesterol', 'mg', 'other', 0, 300, 'mg', 100, TRUE, TRUE),
    (gen_random_uuid(), 'alcohol_grams', 'Alcohol', 'g', 'other', 1, NULL, NULL, 101, TRUE, TRUE);

-- ---------------------------------------------------------------------------
-- Helper function: updated_at trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER nutrient_definitions_updated_at
    BEFORE UPDATE ON nutrient_definitions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER food_nutrient_values_updated_at
    BEFORE UPDATE ON food_nutrient_values
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Back-compat view: current flat nutrient columns on foods table
-- ---------------------------------------------------------------------------
-- This view allows existing queries to continue working while new code
-- should migrate to the food_nutrient_values table.
-- (View definition would go here if needed; current code uses direct columns)