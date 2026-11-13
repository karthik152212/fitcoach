-- Migration: Add Unified Decision Brain Models (Phase 8)
--
-- Implements decision snapshots, evidence, assumptions, and outcomes
-- for the Unified Decision Brain engine.

-- ---------------------------------------------------------------------------
-- Decision Snapshots: immutable decision records with supersession chain
-- ---------------------------------------------------------------------------

CREATE TABLE decision_snapshots (
    id                   UUID NOT NULL PRIMARY KEY,
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    decided_at           DATE NOT NULL,
    kind                 TEXT NOT NULL,
    status               TEXT NOT NULL,
    unified_state_id     UUID NOT NULL,
    diagnoses_addressed  TEXT[] NOT NULL DEFAULT '{}',
    monitoring_plan      TEXT[] NOT NULL DEFAULT '{}',
    config_version       TEXT NOT NULL,
    summary              TEXT NOT NULL,
    confidence           TEXT NOT NULL,
    supersedes_id        UUID REFERENCES decision_snapshots(id) ON DELETE SET NULL,
    warnings             TEXT[] NOT NULL DEFAULT '{}',
    created_at           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CHECK constraints
ALTER TABLE decision_snapshots ADD CONSTRAINT decision_snapshots_kind_check
    CHECK (kind IN ('no_change', 'intervention_selected', 'plan_adaptation', 'measurement_protocol_change'));

ALTER TABLE decision_snapshots ADD CONSTRAINT decision_snapshots_status_check
    CHECK (status IN ('current', 'superseded', 'archived'));

ALTER TABLE decision_snapshots ADD CONSTRAINT decision_snapshots_confidence_check
    CHECK (confidence IN ('measured', 'label_declared', 'estimated', 'unknown'));

-- Indexes
CREATE INDEX decision_snapshots_user_id_decided_at_idx ON decision_snapshots(user_id, decided_at DESC);
CREATE INDEX decision_snapshots_status_idx ON decision_snapshots(status);
CREATE INDEX decision_snapshots_unified_state_id_idx ON decision_snapshots(unified_state_id);

-- ---------------------------------------------------------------------------
-- Decision Interventions: selected interventions within a decision
-- ---------------------------------------------------------------------------

CREATE TABLE decision_interventions (
    id                    UUID NOT NULL PRIMARY KEY,
    decision_snapshot_id  UUID NOT NULL REFERENCES decision_snapshots(id) ON DELETE CASCADE,
    kind                  TEXT NOT NULL,
    parameters            JSONB NOT NULL DEFAULT '{}',
    rationale             TEXT NOT NULL,
    expected_effect       TEXT NOT NULL,
    addresses_diagnoses   TEXT[] NOT NULL DEFAULT '{}',
    review_on             DATE,
    created_at            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CHECK constraint
ALTER TABLE decision_interventions ADD CONSTRAINT decision_interventions_kind_check
    CHECK (kind IN ('nutrition_target_adjustment', 'training_volume_adjustment', 'exercise_substitution', 'split_structure_adjustment', 'progression_scheme_adjustment', 'recovery_adjustment', 'activity_target_adjustment', 'measurement_protocol_adjustment', 'food_choice_guidance', 'no_change'));

-- Indexes
CREATE INDEX decision_interventions_decision_snapshot_id_idx ON decision_interventions(decision_snapshot_id);

-- ---------------------------------------------------------------------------
-- Decision Evidence: evidence citations supporting a decision
-- ---------------------------------------------------------------------------

CREATE TABLE decision_evidence (
    id                    UUID NOT NULL PRIMARY KEY,
    decision_snapshot_id  UUID NOT NULL REFERENCES decision_snapshots(id) ON DELETE CASCADE,
    source_engine         TEXT NOT NULL,
    code                  TEXT NOT NULL,
    title                 TEXT NOT NULL,
    metric                TEXT NOT NULL,
    "window"              TEXT NOT NULL,
    observed              TEXT NOT NULL,
    observed_numeric      NUMERIC(14, 4),
    expected              TEXT,
    confidence            TEXT NOT NULL,
    provenance_class      TEXT NOT NULL,
    severity              TEXT NOT NULL,
    sensitive             BOOLEAN NOT NULL DEFAULT FALSE,
    created_at            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CHECK constraints
ALTER TABLE decision_evidence ADD CONSTRAINT decision_evidence_source_engine_check
    CHECK (source_engine IN ('training_state', 'nutrition_state', 'body_state', 'recovery_state', 'activity_state', 'projection_state', 'goal_state'));

ALTER TABLE decision_evidence ADD CONSTRAINT decision_evidence_confidence_check
    CHECK (confidence IN ('measured', 'label_declared', 'estimated', 'unknown'));

ALTER TABLE decision_evidence ADD CONSTRAINT decision_evidence_provenance_class_check
    CHECK (provenance_class IN ('direct_measurement', 'label_declared', 'derived_calculation', 'heuristic_estimate', 'user_reported', 'third_party_import'));

ALTER TABLE decision_evidence ADD CONSTRAINT decision_evidence_severity_check
    CHECK (severity IN ('informational', 'watch', 'act', 'urgent'));

-- Indexes
CREATE INDEX decision_evidence_decision_snapshot_id_idx ON decision_evidence(decision_snapshot_id);
CREATE INDEX decision_evidence_source_engine_code_idx ON decision_evidence(source_engine, code);

-- ---------------------------------------------------------------------------
-- Decision Assumptions: explicit assumptions underlying a decision
-- ---------------------------------------------------------------------------

CREATE TABLE decision_assumptions (
    id                    UUID NOT NULL PRIMARY KEY,
    decision_snapshot_id  UUID NOT NULL REFERENCES decision_snapshots(id) ON DELETE CASCADE,
    code                  TEXT NOT NULL,
    description           TEXT NOT NULL,
    category              TEXT NOT NULL,
    value                 TEXT NOT NULL,
    sensitive             BOOLEAN NOT NULL DEFAULT FALSE,
    source                TEXT NOT NULL,
    created_at            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CHECK constraints
ALTER TABLE decision_assumptions ADD CONSTRAINT decision_assumptions_category_check
    CHECK (category IN ('adherence', 'progression_rate', 'recovery', 'measurement_consistency'));

ALTER TABLE decision_assumptions ADD CONSTRAINT decision_assumptions_source_check
    CHECK (source IN ('configuration', 'projection', 'user_declared'));

-- Indexes
CREATE INDEX decision_assumptions_decision_snapshot_id_idx ON decision_assumptions(decision_snapshot_id);
CREATE INDEX decision_assumptions_category_idx ON decision_assumptions(category);

-- ---------------------------------------------------------------------------
-- Decision Outcomes: outcome evaluations of decision snapshots
-- ---------------------------------------------------------------------------

CREATE TABLE decision_outcomes (
    id                      UUID NOT NULL PRIMARY KEY,
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    decision_snapshot_id    UUID NOT NULL REFERENCES decision_snapshots(id) ON DELETE CASCADE,
    evaluated_at            TIMESTAMPTZ(6) NOT NULL,
    evaluation_window       TEXT NOT NULL,
    verdict                 TEXT NOT NULL,
    intervention_verdicts   JSONB NOT NULL,
    observations            TEXT[] NOT NULL DEFAULT '{}',
    explanation             TEXT NOT NULL,
    follow_up_diagnosis_ids TEXT[] NOT NULL DEFAULT '{}',
    triggers_reevaluation   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CHECK constraint
ALTER TABLE decision_outcomes ADD CONSTRAINT decision_outcomes_verdict_check
    CHECK (verdict IN ('improved_as_expected', 'partially_improved', 'no_effect', 'worsened', 'uncertain', 'too_early'));

-- Indexes
CREATE UNIQUE INDEX decision_outcomes_decision_snapshot_id_evaluation_window_idx ON decision_outcomes(decision_snapshot_id, evaluation_window);
CREATE INDEX decision_outcomes_decision_snapshot_id_idx ON decision_outcomes(decision_snapshot_id);
CREATE INDEX decision_outcomes_user_id_idx ON decision_outcomes(user_id);

-- ---------------------------------------------------------------------------
-- Helper function: updated_at trigger (reuses existing)
-- ---------------------------------------------------------------------------

CREATE TRIGGER decision_snapshots_updated_at
    BEFORE UPDATE ON decision_snapshots
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();