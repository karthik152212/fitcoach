import { useState } from "react";
import { useNavigate } from "react-router-dom";
import * as endpoints from "../api/endpoints";
import { useAsync } from "../api/hooks";
import type { EnvironmentLimitation, TrainingEnvironmentKind } from "../api/types";
import { Button, Chip, Expandable, StateBlock } from "../components/controls";
import { humanise, humaniseProse, sentence } from "../lib/text";
import { useSession } from "../session/SessionContext";

/**
 * You: body/profile context, goal, equipment, and the training environment —
 * including declaring a temporary environment and restoring the gym, with the
 * engine's limitations stated honestly.
 */

const ENVIRONMENT_LABELS: Record<TrainingEnvironmentKind, string> = {
  gym: "Gym",
  home: "Home",
  home_no_equipment: "Home — no equipment",
  home_limited_equipment: "Home — limited equipment",
  hotel: "Hotel",
  travel: "Travel",
  outdoor: "Outdoor",
  custom: "Custom",
};

const TEMPORARY_CHOICES: TrainingEnvironmentKind[] = ["home", "home_no_equipment", "home_limited_equipment", "hotel", "travel", "outdoor"];

function percent(share: number | undefined): string {
  if (share === undefined) return "";
  if (share === 0.5) return " (about half the usual stimulus)";
  return ` (${Math.round(share * 100)}% of the usual stimulus)`;
}

/**
 * Environment limitations, grouped by kind so the user reads one honest
 * statement per consequence instead of the same sentence per muscle. The
 * words and the retained-stimulus numbers come from the engine; only the
 * grouping is presentation.
 */
export function Limitations({ limitations }: { limitations: readonly EnvironmentLimitation[] }) {
  const reduced = limitations.filter((item) => item.kind === "muscle_coverage" && (item.retainedStimulus ?? 0) > 0);
  const unavailable = limitations.filter((item) => (item.retainedStimulus ?? 0) === 0);
  const rest = limitations.filter(
    (item) => !reduced.includes(item) && !unavailable.includes(item),
  );
  const share = reduced.length > 0 ? Math.min(...reduced.map((item) => item.retainedStimulus ?? 1)) : undefined;

  return (
    <dl className="fc-limits">
      {reduced.length > 0 ? (
        <div className="fc-limits__row">
          <dt>Reduced stimulus{percent(share)}</dt>
          <dd>{reduced.map((item) => humanise(item.subject)).join(" · ")}</dd>
        </div>
      ) : null}
      {unavailable.length > 0 ? (
        <div className="fc-limits__row">
          <dt>Not trainable in this setup</dt>
          <dd>{unavailable.map((item) => humanise(item.subject)).join(" · ")}</dd>
        </div>
      ) : null}
      {rest.map((item) => (
        <div key={`${item.kind}-${item.subject}`} className="fc-limits__row">
          <dt>{humanise(item.kind)}</dt>
          <dd>{humaniseProse(item.description)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function YouScreen() {
  const { userId, signOut } = useSession();
  const navigate = useNavigate();
  const [envBusy, setEnvBusy] = useState(false);
  const [envError, setEnvError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const state = useAsync(async () => {
    if (!userId) return null;
    const [user, profile, goal, equipment, environment, trainingState] = await Promise.all([
      endpoints.getUser(userId),
      endpoints.getProfile(userId).catch(() => ({ profile: null })),
      endpoints.getActiveGoal(userId).catch(() => ({ goal: null })),
      endpoints.getUserEquipment(userId).catch(() => ({ equipment: [] })),
      endpoints.getActiveEnvironment(userId).catch(() => null),
      endpoints.getTrainingState(userId).catch(() => ({ trainingState: null })),
    ]);
    return { user: user.user, profile: profile.profile, goal: goal.goal, equipment: equipment.equipment, environment: environment?.environment ?? null, trainingState: trainingState.trainingState };
  }, [userId, nonce]);

  if (!userId) return <StateBlock kind="empty" title="Sign in to see your context" />;
  if (state.status === "loading") return <StateBlock kind="loading" title="Loading your context" />;
  if (state.status === "error" || !state.data) {
    return <StateBlock kind="error" title="Context unavailable" body={state.status === "error" ? state.error.message : undefined} action={state.status === "error" ? <Button onClick={state.retry}>Retry</Button> : undefined} />;
  }

  const { user, profile, goal, equipment, environment } = state.data;

  const declareEnvironment = async (kind: TrainingEnvironmentKind) => {
    setEnvBusy(true);
    setEnvError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await endpoints.setEnvironment(userId, { kind, effectiveFrom: today, reason: "Declared in the app", isTemporary: true });
      await endpoints.generateTemporaryPlan(userId, { asOf: today });
      setNonce((n) => n + 1);
    } catch (cause) {
      // Changing where you train rewrites the week: if it fails, the current
      // environment must visibly stay the one that is really in effect.
      setEnvError(cause instanceof Error ? cause.message : "The environment could not be changed.");
    } finally {
      setEnvBusy(false);
    }
  };

  const restoreGym = async () => {
    setEnvBusy(true);
    setEnvError(null);
    try {
      await endpoints.restoreEnvironment(userId, new Date().toISOString().slice(0, 10));
      setNonce((n) => n + 1);
    } catch (cause) {
      setEnvError(cause instanceof Error ? cause.message : "Your gym plan could not be restored.");
    } finally {
      setEnvBusy(false);
    }
  };

  return (
    <div className="fc-screen fc-you">
      <header className="fc-screen__header">
        <div>
          <p className="t-caption t-muted">You</p>
          <h1 className="t-title">{user.displayName}</h1>
        </div>
      </header>

      <section className="fc-you__section" aria-label="Training context">
        <dl className="fc-facts">
          {goal ? (
            <div className="fc-facts__row">
              <dt>Goal</dt>
              <dd>{sentence(goal.kind)}</dd>
            </div>
          ) : null}
          {profile?.trainingExperience ? (
            <div className="fc-facts__row">
              <dt>Experience</dt>
              <dd>{sentence(profile.trainingExperience)}</dd>
            </div>
          ) : null}
          {profile?.trainingDaysPerWeek ? (
            <div className="fc-facts__row">
              <dt>Schedule</dt>
              <dd>
                {profile.trainingDaysPerWeek} days · {profile.sessionDurationMinutes} min
              </dd>
            </div>
          ) : null}
          {profile?.heightCm ? (
            <div className="fc-facts__row">
              <dt>Height</dt>
              <dd>{profile.heightCm} cm</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="fc-you__section" aria-labelledby="you-env">
        <div className="fc-you__envhead">
          <h2 className="t-heading" id="you-env">Training environment</h2>
          {environment ? <Chip tone={environment.constrained ? "warning" : "success"}>{ENVIRONMENT_LABELS[environment.kind]}</Chip> : null}
        </div>
        {environment?.constrained && environment.limitations.length > 0 ? (
          <Limitations limitations={environment.limitations} />
        ) : (
          <p className="t-body t-secondary">Full equipment universe available; nothing is knowingly reduced.</p>
        )}
        <Expandable summary="Training away from your usual setup?">
          <p>
            Tell FitCoach where you are. Your gym plan is preserved; a temporary adapted plan covers
            the time away — with its limits stated, never hidden.
          </p>
          <div className="fc-choice-grid">
            {TEMPORARY_CHOICES.map((kind) => (
              <button key={kind} type="button" className="fc-choice" disabled={envBusy} onClick={() => void declareEnvironment(kind)}>
                {ENVIRONMENT_LABELS[kind]}
              </button>
            ))}
          </div>
          {environment?.kind !== "gym" ? (
            <Button variant="secondary" disabled={envBusy} onClick={() => void restoreGym()}>
              I'm back at the gym
            </Button>
          ) : null}
          {envError ? (
            <p className="fc-inline-error t-small" role="alert">
              {envError}
            </p>
          ) : null}
        </Expandable>
      </section>

      <section className="fc-you__section" aria-label="Equipment">
        <h2 className="t-heading">Equipment</h2>
        {equipment.length === 0 ? (
          <p className="t-body t-secondary">Nothing recorded — FitCoach assumes bodyweight training is always possible.</p>
        ) : (
          <ul className="fc-you__equiplist" role="list">
            {equipment.map((item) => (
              <li key={item.id} className="t-body t-secondary">
                {item.equipment.name}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="fc-you__section">
        <Button
          variant="quiet"
          onClick={() => {
            signOut();
            navigate("/onboarding");
          }}
        >
          Sign out of this device
        </Button>
      </section>
    </div>
  );
}
