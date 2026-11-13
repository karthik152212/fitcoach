import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as endpoints from "../api/endpoints";
import { useAsync } from "../api/hooks";
import type { DailyActivitySummary, ActivityTargets, ActivityContext } from "../api/types";
import { Button, Chip, StateBlock } from "../components/controls";
import { sentence, formatNumber } from "../lib/text";
import { useSession } from "../session/SessionContext";

/**
 * Activity Screen: Daily movement, personalized targets, and context.
 * Mirrors the adaptive Home pattern — priority sections, not metric dashboards.
 */

export interface ActivitySection {
  id: string;
  priority: number;
  tone: "quiet" | "insight" | "intervention";
  title: string;
  body?: string;
  action?: { label: string; to: string };
}

function deriveActivitySections(input: {
  targets: ActivityTargets | null;
  context: ActivityContext | null;
  recentSummaries: readonly DailyActivitySummary[];
}): ActivitySection[] {
  const { targets, context, recentSummaries } = input;
  const sections: ActivitySection[] = [];

  // Target insight
  if (targets) {
    const gap = targets.dailyStepsTarget - (context?.averageSteps ?? 0);
    if (gap > 2000) {
      sections.push({
        id: "target_gap_large",
        priority: 10,
        tone: "intervention",
        title: `Daily steps target: ${formatNumber(targets.dailyStepsTarget)}`,
        body: `Your recent average is ${formatNumber(context?.averageSteps ?? 0)} — a gap of ${formatNumber(gap)}. We cap increases at 2,000/day to keep it sustainable.`,
        action: { label: "View targets", to: "/activity/targets" },
      });
    } else if (gap > 500) {
      sections.push({
        id: "target_gap_moderate",
        priority: 15,
        tone: "insight",
        title: `Daily steps target: ${formatNumber(targets.dailyStepsTarget)}`,
        body: `You're ${formatNumber(gap)} steps short of target. Small consistent increases work best.`,
        action: { label: "View targets", to: "/activity/targets" },
      });
    } else if (gap < -500) {
      sections.push({
        id: "target_exceeding",
        priority: 15,
        tone: "quiet",
        title: `Exceeding target by ${formatNumber(-gap)} steps/day`,
        body: "Great consistency. Target will adjust upward gradually.",
      });
    } else {
      sections.push({
        id: "target_on_track",
        priority: 20,
        tone: "quiet",
        title: `On track: ${formatNumber(targets.dailyStepsTarget)} steps/day`,
        body: `Recent average: ${formatNumber(context?.averageSteps ?? 0)}. Target adjusts with your context.`,
      });
    }
  }

  // Weekly cardio context
  if (targets && context) {
    const cardioGap = targets.weeklyCardioMinTarget - context.weeklyCardioMinutes;
    if (cardioGap > 30) {
      sections.push({
        id: "cardio_gap",
        priority: 12,
        tone: "insight",
        title: `Weekly cardio: ${context.weeklyCardioMinutes} / ${targets.weeklyCardioMinTarget} min`,
        body: `${cardioGap} min short of target. Cardio supports recovery and work capacity.`,
      });
    }
  }

  // Recent trend
  if (recentSummaries.length >= 7) {
    const last7 = recentSummaries.slice(0, 7);
    const prev7 = recentSummaries.slice(7, 14);
    if (prev7.length >= 3) {
      const lastAvg = last7.reduce((s, d) => s + d.steps, 0) / last7.length;
      const prevAvg = prev7.reduce((s, d) => s + d.steps, 0) / prev7.length;
      const change = Math.round(lastAvg - prevAvg);
      if (Math.abs(change) > 500) {
        sections.push({
          id: "trend",
          priority: 8,
          tone: change > 0 ? "insight" : "intervention",
          title: `7-day step trend: ${change > 0 ? "+" : ""}${formatNumber(change)}`,
          body: change > 0
            ? "Steps are trending up — good momentum."
            : "Steps have dropped. Consider a daily walk habit.",
        });
      }
    }
  }

  // Active minutes context
  if (targets && context) {
    const activeGap = targets.weeklyActiveMinTarget - (context.averageActiveMinutes * 7);
    if (activeGap > 60) {
      sections.push({
        id: "active_minutes",
        priority: 10,
        tone: "insight",
        title: `Weekly active minutes: ${Math.round(context.averageActiveMinutes * 7)} / ${targets.weeklyActiveMinTarget}`,
        body: "Active minutes include training + cardio. Both count toward health.",
      });
    }
  }

  // Basis note from targets
  if (targets?.basisNote) {
    sections.push({
      id: "basis",
      priority: 5,
      tone: "quiet",
      title: "How your target is calculated",
      body: targets.basisNote,
    });
  }

  if (sections.length === 0) {
    sections.push({
      id: "no_data",
      priority: 0,
      tone: "quiet",
      title: "Start tracking activity",
      body: "Record steps, walks, runs, or training to see personalized targets.",
      action: { label: "Log activity", to: "/activity/log" },
    });
  }

  return sections.sort((a, b) => b.priority - a.priority);
}

export function ActivityScreen() {
  const { userId } = useSession();
  const [dateRange] = useState<{ from: string; to: string }>(() => ({
    from: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!,
    to: new Date().toISOString().split("T")[0]!,
  }));

  const targets = useAsync(async () => {
    if (!userId) return null;
    const res = await endpoints.getActivityTargets(userId);
    return res.targets;
  }, [userId]);

  const context = useAsync(async () => {
    if (!userId) return null;
    const res = await endpoints.getActivityContext(userId, 14);
    return res.context;
  }, [userId]);

  const summaries = useAsync(async () => {
    if (!userId) return [] as DailyActivitySummary[];
    const res = await endpoints.getDailyActivitySummaries(userId, dateRange.from, dateRange.to);
    return res.dailySummaries;
  }, [userId, dateRange.from, dateRange.to]);

  const sections = useMemo(() => {
    if (targets.status !== "ready" || context.status !== "ready" || summaries.status !== "ready") {
      return [];
    }
    return deriveActivitySections({
      targets: targets.data,
      context: context.data,
      recentSummaries: summaries.data,
    });
  }, [targets, context, summaries]);

  const loading = targets.status === "loading" || context.status === "loading" || summaries.status === "loading";
  const error = targets.status === "error" || context.status === "error" || summaries.status === "error";

  if (!userId) {
    return (
      <div className="fc-screen fc-activity">
        <section className="fc-screen__hero motion-rise">
          <p className="t-caption t-muted">Activity</p>
          <h1 className="t-display">Movement that fits your life.</h1>
          <p className="t-body t-secondary fc-measure">
            Personalized step and cardio targets based on your goal, training, and recovery.
          </p>
        </section>
      </div>
    );
  }

  if (loading) return <StateBlock kind="loading" title="Loading activity" />;
  if (error) {
    const err = targets.status === "error" ? targets : context.status === "error" ? context : summaries.status === "error" ? summaries : null;
    return (
      <StateBlock
        kind="error"
        title="Failed to load activity"
        body={err?.error?.message}
        action={err ? <Button onClick={err.retry}>Retry</Button> : null}
      />
    );
  }

  const todaySummary = summaries.data[0];
  const avgSteps = context.data?.averageSteps ?? 0;
  const weeklyCardio = context.data?.weeklyCardioMinutes ?? 0;
  const targetSteps = targets.data?.dailyStepsTarget ?? 0;
  const targetCardio = targets.data?.weeklyCardioMinTarget ?? 0;

  return (
    <div className="fc-screen fc-activity">
      {/* Hero: Today at a glance */}
      <section className="fc-activity__hero motion-rise" aria-labelledby="activity-today">
        <div className="fc-activity__today-grid">
          <article className="fc-metric">
            <p className="t-caption t-muted">Steps today</p>
            <h2 className="t-display fc-metric__value">{formatNumber(todaySummary?.steps ?? 0)}</h2>
            <p className="t-small t-secondary">Target: {formatNumber(targetSteps)}</p>
          </article>
          <article className="fc-metric">
            <p className="t-caption t-muted">Active min today</p>
            <h2 className="t-display fc-metric__value">{todaySummary?.activeMinutes ?? 0}</h2>
            <p className="t-small t-secondary">Cardio: {todaySummary?.cardioMinutes ?? 0} min</p>
          </article>
          <article className="fc-metric">
            <p className="t-caption t-muted">7-day avg steps</p>
            <h2 className="t-display fc-metric__value">{formatNumber(avgSteps)}</h2>
            <p className="t-small t-secondary">Target: {formatNumber(targetSteps)}</p>
          </article>
          <article className="fc-metric">
            <p className="t-caption t-muted">Weekly cardio</p>
            <h2 className="t-display fc-metric__value">{weeklyCardio} min</h2>
            <p className="t-small t-secondary">Target: {targetCardio} min</p>
          </article>
        </div>

        <div className="fc-activity__sparkline" aria-label="14-day step trend">
          <canvas
            id="steps-sparkline"
            width={340}
            height={60}
            role="img"
            aria-label={`14-day steps: ${summaries.data.slice(0, 14).map((d) => d.steps).join(", ")}`}
          />
        </div>

        <div className="fc-activity__actions">
          <Link to="/activity/log" className="fc-link-button">
            <Button size="base" variant="primary">Log activity</Button>
          </Link>
          <Link to="/activity/targets" className="fc-link-button">
            <Button size="base" variant="secondary">View targets</Button>
          </Link>
        </div>
      </section>

      {/* Priority sections */}
      <section className="fc-activity__sections" aria-label="What matters now">
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

      {/* Recent days list */}
      <section className="fc-activity__recent">
        <h2 className="t-title">Recent days</h2>
        <div className="fc-activity__list">
          {summaries.data.slice(0, 14).map((day) => (
            <article key={day.date} className="fc-day-card">
              <div className="fc-day-card__date">
                <time dateTime={day.date}>{new Date(day.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</time>
              </div>
              <div className="fc-day-card__metrics">
                <span className="fc-day-card__metric">
                  <span className="t-caption t-muted">Steps</span>
                  <span className="t-body">{formatNumber(day.steps)}</span>
                </span>
                <span className="fc-day-card__metric">
                  <span className="t-caption t-muted">Active</span>
                  <span className="t-body">{day.activeMinutes} min</span>
                </span>
                <span className="fc-day-card__metric">
                  <span className="t-caption t-muted">Cardio</span>
                  <span className="t-body">{day.cardioMinutes} min</span>
                </span>
                <span className="fc-day-card__metric">
                  <span className="t-caption t-muted">Training</span>
                  <span className="t-body">{day.trainingMinutes} min</span>
                </span>
              </div>
              {day.sessions.length > 0 && (
                <div className="fc-day-card__sessions">
                  {day.sessions.map((s) => (
                    <Chip key={s.id} tone="neutral" size="sm">
                      {sentence(s.kind)} {s.durationMinutes ? `· ${s.durationMinutes}min` : ""}
                    </Chip>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}