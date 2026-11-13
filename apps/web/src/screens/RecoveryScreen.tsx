import { useMemo } from "react";
import { Link } from "react-router-dom";
import * as endpoints from "../api/endpoints";
import { useAsync } from "../api/hooks";
import type { RecoveryState, RecoveryPlateauSignal } from "../api/types";
import { Button, StateBlock } from "../components/controls";
import { useSession } from "../session/SessionContext";

/**
 * Recovery Screen: Readiness, sleep, HRV, and training recommendations.
 * Mirrors the adaptive Home pattern — priority sections with clear actions.
 */

export interface RecoverySection {
  id: string;
  priority: number;
  tone: "quiet" | "insight" | "intervention";
  title: string;
  body?: string;
  action?: { label: string; to: string };
}

function deriveRecoverySections(input: {
  state: RecoveryState | null;
  signals: readonly RecoveryPlateauSignal[];
}): RecoverySection[] {
  const { state, signals } = input;
  const sections: RecoverySection[] = [];

  if (!state) {
    sections.push({
      id: "no_data",
      priority: 0,
      tone: "quiet",
      title: "Start tracking recovery",
      body: "Log sleep, HRV, and subjective markers to see your readiness score.",
      action: { label: "Log recovery", to: "/recovery/log" },
    });
    return sections;
  }

  // Readiness score (primary)
  const readinessTone = state.readinessScore >= 75 ? "quiet" : state.readinessScore >= 50 ? "insight" : "intervention";
  sections.push({
    id: "readiness",
    priority: 25,
    tone: readinessTone,
    title: `Readiness: ${state.readinessScore}/100`,
    body:
      state.readinessScore >= 75
        ? "Well recovered. Training and activity targets at full."
        : state.readinessScore >= 50
        ? "Moderate recovery. Consider reducing volume if training feels hard."
        : "Low recovery. Prioritize sleep, nutrition, and low-intensity movement.",
    action: { label: "View details", to: "/recovery/details" },
  });

  // Limiting factors
  if (state.limitingFactors.length > 0) {
    const topFactor = state.limitingFactors[0];
    const factorLabels: Record<string, string> = {
      severe_sleep_debt: "Severe sleep debt",
      moderate_sleep_debt: "Moderate sleep debt",
      hrv_declining: "HRV declining",
      high_training_fatigue: "High training fatigue",
      very_high_training_fatigue: "Very high training fatigue",
      high_muscle_soreness: "High muscle soreness",
      high_fatigue: "High fatigue",
      poor_nutrition_adherence: "Poor nutrition adherence",
    };
    sections.push({
      id: "limiting_factor",
      priority: 20,
      tone: "intervention",
      title: `Primary limiter: ${factorLabels[topFactor as keyof typeof factorLabels] ?? topFactor}`,
      body: state.limitingFactors.length > 1
        ? `Also: ${state.limitingFactors.slice(1).map((f) => factorLabels[f as keyof typeof factorLabels] ?? f).join(", ")}`
        : "Address this first for the biggest recovery gain.",
    });
  }

  // Training recommendation
  const recLabels: Record<string, { label: string; tone: RecoverySection["tone"] }> = {
    maintain: { label: "Train as planned", tone: "quiet" },
    active_recovery: { label: "Active recovery", tone: "insight" },
    reduce_volume: { label: "Reduce volume", tone: "insight" },
    delay: { label: "Delay training", tone: "intervention" },
  };
  const rec = recLabels[state.trainingRecommendation] ?? { label: state.trainingRecommendation, tone: "quiet" };
  sections.push({
    id: "training_rec",
    priority: 18,
    tone: rec.tone,
    title: `Training: ${rec.label}`,
    body: trainingRecBody(state.trainingRecommendation),
  });

  // Sleep adequacy
  const sleepLabels: Record<typeof state.sleepAdequacy, string> = {
    adequate: "Sleep adequate",
    moderate_debt: "Moderate sleep debt",
    severe_debt: "Severe sleep debt",
  };
  const sleepTone = state.sleepAdequacy === "adequate" ? "quiet" : state.sleepAdequacy === "moderate_debt" ? "insight" : "intervention";
  sections.push({
    id: "sleep_adequacy",
    priority: 15,
    tone: sleepTone,
    title: `Sleep: ${sleepLabels[state.sleepAdequacy]}`,
    body: sleepBody(state.sleepAdequacy),
  });

  // HRV trend
  const hrvLabels: Record<typeof state.hrvTrend, string> = {
    improving: "HRV improving",
    stable: "HRV stable",
    declining: "HRV declining",
    unknown: "HRV baseline building",
  };
  const hrvTone = state.hrvTrend === "improving" ? "quiet" : state.hrvTrend === "stable" ? "quiet" : "intervention";
  sections.push({
    id: "hrv",
    priority: 12,
    tone: hrvTone,
    title: hrvLabels[state.hrvTrend],
    body: state.hrvTrend === "declining" ? "Autonomic stress detected. Prioritize recovery." : undefined,
  });

  // Fatigue accumulation
  const fatigueLabels: Record<typeof state.fatigueAccumulation, string> = {
    low: "Low training fatigue",
    moderate: "Moderate training fatigue",
    high: "High training fatigue",
    very_high: "Very high training fatigue",
  };
  const fatigueTone = state.fatigueAccumulation === "low" ? "quiet" : state.fatigueAccumulation === "moderate" ? "insight" : "intervention";
  sections.push({
    id: "fatigue",
    priority: 10,
    tone: fatigueTone,
    title: fatigueLabels[state.fatigueAccumulation],
    body:
      state.fatigueAccumulation === "high" || state.fatigueAccumulation === "very_high"
        ? "Acute load exceeds chronic. Consider a deload week."
        : undefined,
  });

  // Nutrition recommendations
  if (state.nutritionRecommendations.length > 0) {
    sections.push({
      id: "nutrition_recs",
      priority: 8,
      tone: "insight",
      title: "Nutrition for recovery",
      body: state.nutritionRecommendations.map((r) => nutritionRecLabel(r)).join(". "),
    });
  }

  // Activity recommendations
  if (state.activityRecommendations.length > 0) {
    sections.push({
      id: "activity_recs",
      priority: 7,
      tone: "insight",
      title: "Activity adjustments",
      body: state.activityRecommendations.map((r) => activityRecLabel(r)).join(". "),
    });
  }

  // Plateau signals for adaptation
  if (signals.length > 0) {
    sections.push({
      id: "plateau_signals",
      priority: 5,
      tone: "insight",
      title: "Adaptation signals",
      body: signals.map((s) => s.observation).join("; "),
    });
  }

  // Basis note
  if (state.basisNote) {
    sections.push({
      id: "basis",
      priority: 3,
      tone: "quiet",
      title: "How this is calculated",
      body: state.basisNote,
    });
  }

  return sections.sort((a, b) => b.priority - a.priority);
}

function trainingRecBody(rec: string): string {
  switch (rec) {
    case "maintain":
      return "Recovery supports your planned training. No changes needed.";
    case "active_recovery":
      return "Focus on mobility, light cardio, and movement quality today.";
    case "reduce_volume":
      return "Cut working sets by 30–50%. Keep intensity, drop volume.";
    case "delay":
      return "Rest today. Training under high fatigue increases injury risk.";
    default:
      return "";
  }
}

function sleepBody(adequacy: string): string {
  switch (adequacy) {
    case "adequate":
      return "Consistently meeting sleep need. Recovery foundation is solid.";
    case "moderate_debt":
      return "Accumulating sleep debt. Aim for 30–60 min extra tonight.";
    case "severe_debt":
      return "Critical sleep debt. Recovery capacity severely limited.";
    default:
      return "";
  }
}

function nutritionRecLabel(rec: string): string {
  switch (rec) {
    case "increase_protein_intake":
      return "Increase protein to support repair";
    case "ensure_adequate_calories":
      return "Ensure adequate calories";
    case "moderate_calorie_surplus":
      return "Moderate calorie surplus";
    default:
      return rec;
  }
}

function activityRecLabel(rec: string): string {
  switch (rec) {
    case "reduce_daily_steps_target_15_to_20_percent":
      return "Reduce daily steps target 15–20%";
    case "prioritize_low_intensity_movement":
      return "Prioritize low-intensity movement";
    case "maintain_steps_focus_on_walking":
      return "Maintain steps, focus on walking";
    default:
      return rec;
  }
}

export function RecoveryScreen() {
  const { userId } = useSession();

  const state = useAsync(async () => {
    if (!userId) return null;
    const res = await endpoints.getRecoveryState(userId);
    return res.state;
  }, [userId]);

  const signals = useAsync(async () => {
    if (!userId) return [] as RecoveryPlateauSignal[];
    const res = await endpoints.getRecoveryPlateauSignals(userId);
    return res.signals;
  }, [userId]);

  const sections = useMemo(() => {
    if (state.status !== "ready" || signals.status !== "ready") return [];
    return deriveRecoverySections({
      state: state.data,
      signals: signals.data,
    });
  }, [state, signals]);

  const loading = state.status === "loading" || signals.status === "loading";
  const error = state.status === "error" || signals.status === "error";

  if (!userId) {
    return (
      <div className="fc-screen fc-recovery">
        <section className="fc-screen__hero motion-rise">
          <p className="t-caption t-muted">Recovery</p>
          <h1 className="t-display">Readiness that adapts to you.</h1>
          <p className="t-body t-secondary fc-measure">
            Sleep, HRV, training load, and nutrition — one score, clear actions.
          </p>
        </section>
      </div>
    );
  }

  if (loading) return <StateBlock kind="loading" title="Loading recovery" />;
  if (error) {
    const err = state.status === "error" ? state : signals.status === "error" ? signals : null;
    return (
      <StateBlock
        kind="error"
        title="Failed to load recovery"
        body={err?.error?.message}
        action={err ? <Button onClick={err.retry}>Retry</Button> : null}
      />
    );
  }

  const s = state.data!;
  const readinessColor = s.readinessScore >= 75 ? "var(--fc-success)" : s.readinessScore >= 50 ? "var(--fc-warning)" : "var(--fc-error)";

  return (
    <div className="fc-screen fc-recovery">
      {/* Hero: Readiness score */}
      <section className="fc-recovery__hero motion-rise" aria-labelledby="recovery-readiness">
        <div className="fc-recovery__score" role="img" aria-label={`Readiness score: ${s.readinessScore} out of 100`} style={{ "--fc-readiness-color": readinessColor } as React.CSSProperties}>
          <span className="fc-recovery__score-value">{s.readinessScore}</span>
          <span className="fc-recovery__score-max">/100</span>
        </div>
        <p className="t-caption t-muted">Confidence: {Math.round(s.confidence * 100)}%</p>

        <div className="fc-recovery__subscores">
          <article className="fc-subscore">
            <span className="fc-subscore__label">Sleep</span>
            <span className={`fc-subscore__value fc-subscore__value--${s.sleepAdequacy === "adequate" ? "good" : s.sleepAdequacy === "moderate_debt" ? "warn" : "poor"}`}>
              {s.sleepAdequacy === "adequate" ? "✓" : s.sleepAdequacy === "moderate_debt" ? "⚠" : "✗"}
            </span>
          </article>
          <article className="fc-subscore">
            <span className="fc-subscore__label">HRV</span>
            <span className={`fc-subscore__value fc-subscore__value--${s.hrvTrend === "improving" ? "good" : s.hrvTrend === "stable" ? "neutral" : "poor"}`}>
              {s.hrvTrend === "improving" ? "▲" : s.hrvTrend === "stable" ? "●" : "▼"}
            </span>
          </article>
          <article className="fc-subscore">
            <span className="fc-subscore__label">Training</span>
            <span className={`fc-subscore__value fc-subscore__value--${s.fatigueAccumulation === "low" ? "good" : s.fatigueAccumulation === "moderate" ? "neutral" : "warn"}`}>
              {s.fatigueAccumulation === "low" ? "✓" : s.fatigueAccumulation === "moderate" ? "⚠" : "✗"}
            </span>
          </article>
          <article className="fc-subscore">
            <span className="fc-subscore__label">Nutrition</span>
            <span className="fc-subscore__value fc-subscore__value--neutral">{s.nutritionRecommendations.length === 0 ? "✓" : "⚠"}</span>
          </article>
        </div>

        <div className="fc-recovery__actions">
          <Link to="/recovery/log" className="fc-link-button">
            <Button size="base" variant="primary">Log sleep / HRV</Button>
          </Link>
          <Link to="/recovery/details" className="fc-link-button">
            <Button size="base" variant="secondary">View details</Button>
          </Link>
        </div>
      </section>

      {/* Training recommendation banner */}
      {s.trainingRecommendation !== "maintain" && (
        <div className={`fc-recovery__banner fc-recovery__banner--${recBannerTone(s.trainingRecommendation)}`}>
          <strong>Today's training: </strong>
          <span>{trainingRecBody(s.trainingRecommendation)}</span>
        </div>
      )}

      {/* Priority sections */}
      <section className="fc-recovery__sections" aria-label="Recovery insights">
        {sections.map((section) => (
          <article key={section.id} className={`fc-note fc-note--${section.tone}`}>
            <div className="fc-note__text">
              <h2 className="fc-note__title">{section.title}</h2>
              {section.body ? <p className="fc-note__body">{section.body}</p> : null}
            </div>
            {section.action ? (
              <Link className="fc-note__action" to={section.action.to}>
                {section.action.label}
              </Link>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  );
}

function recBannerTone(rec: string): "info" | "warn" | "alert" {
  if (rec === "delay") return "alert";
  if (rec === "reduce_volume") return "warn";
  return "info";
}