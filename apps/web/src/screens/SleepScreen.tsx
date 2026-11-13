import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as endpoints from "../api/endpoints";
import { useAsync } from "../api/hooks";
import type { SleepObservation, RecoveryIndicator } from "../api/types";
import { Button, StateBlock } from "../components/controls";
import { sentence } from "../lib/text";
import { useSession } from "../session/SessionContext";

/**
 * Sleep Screen: Sleep observations, trends, and quality insights.
 * Focus on duration, efficiency, and stages — with clear logging.
 */

export interface SleepSection {
  id: string;
  priority: number;
  tone: "quiet" | "insight" | "intervention";
  title: string;
  body?: string;
  action?: { label: string; to: string };
}

function deriveSleepSections(input: {
  observations: readonly SleepObservation[];
  indicators: readonly RecoveryIndicator[];
}): SleepSection[] {
  const { observations, indicators } = input;
  const sections: SleepSection[] = [];

  if (observations.length === 0) {
    sections.push({
      id: "no_data",
      priority: 0,
      tone: "quiet",
      title: "No sleep data yet",
      body: "Log sleep from your wearable or manually to see trends and insights.",
      action: { label: "Log sleep", to: "/sleep/log" },
    });
    return sections;
  }

  // Recent sleep (last 7 days)
  const recent = observations.slice(0, 7);
  const withDuration = recent.filter((o) => o.asleepMinutes !== undefined && o.asleepMinutes! > 0);

  if (withDuration.length > 0) {
    const avgHours = withDuration.reduce((s, o) => s + (o.asleepMinutes! / 60), 0) / withDuration.length;
    const avgEfficiency = withDuration
      .filter((o) => o.efficiency !== undefined)
      .reduce((s, o) => s + (o.efficiency ?? 0), 0) / withDuration.filter((o) => o.efficiency !== undefined).length || 0;

    const avgLatency = withDuration
      .filter((o) => o.latencyMinutes !== undefined)
      .reduce((s, o) => s + (o.latencyMinutes ?? 0), 0) / withDuration.filter((o) => o.latencyMinutes !== undefined).length || 0;

    // Sleep duration insight
    if (avgHours < 6.5) {
      sections.push({
        id: "short_sleep",
        priority: 15,
        tone: "intervention",
        title: `Average sleep: ${avgHours.toFixed(1)}h`,
        body: "Below the 6.5h minimum for adequate recovery. Prioritize sleep hygiene.",
        action: { label: "View tips", to: "/sleep/tips" },
      });
    } else if (avgHours < 7.5) {
      sections.push({
        id: "moderate_sleep",
        priority: 12,
        tone: "insight",
        title: `Average sleep: ${avgHours.toFixed(1)}h`,
        body: "Below the 7.5h optimal target. An extra 30–60 min would improve recovery.",
      });
    } else {
      sections.push({
        id: "good_sleep",
        priority: 15,
        tone: "quiet",
        title: `Average sleep: ${avgHours.toFixed(1)}h`,
        body: "Meeting optimal sleep target. Recovery foundation is solid.",
      });
    }

    // Efficiency insight
    if (avgEfficiency > 0 && avgEfficiency < 80) {
      sections.push({
        id: "low_efficiency",
        priority: 10,
        tone: "insight",
        title: `Sleep efficiency: ${Math.round(avgEfficiency)}%`,
        body: "Below 85% suggests fragmented sleep. Check environment, timing, and caffeine.",
      });
    }

    // Latency insight
    if (avgLatency > 30) {
      sections.push({
        id: "high_latency",
        priority: 8,
        tone: "insight",
        title: `Time to fall asleep: ${Math.round(avgLatency)} min`,
        body: "Above 20 min suggests wind-down issues. Consider a pre-sleep routine.",
      });
    }
  }

  // Sleep stages (if available)
  const withStages = recent.filter((o) => o.deepMinutes !== undefined || o.remMinutes !== undefined);
  if (withStages.length >= 3) {
    const avgDeep = withStages.reduce((s, o) => s + (o.deepMinutes ?? 0), 0) / withStages.length;
    const avgRem = withStages.reduce((s, o) => s + (o.remMinutes ?? 0), 0) / withStages.length;
    const avgLight = withStages.reduce((s, o) => s + (o.lightMinutes ?? 0), 0) / withStages.length;
    const total = avgDeep + avgRem + avgLight;
    if (total > 0) {
      const deepPct = Math.round((avgDeep / total) * 100);
      const remPct = Math.round((avgRem / total) * 100);
      sections.push({
        id: "stages",
        priority: 8,
        tone: "quiet",
        title: `Sleep stages: ${deepPct}% deep, ${remPct}% REM`,
        body: "Deep sleep supports physical recovery; REM supports cognitive recovery.",
      });
    }
  }

  // HRV correlation (from recovery indicators)
  const withHrv = indicators.filter((i) => i.hrvMs !== undefined && i.hrvMs! > 0).slice(0, 7);
  if (withHrv.length >= 3 && withDuration.length >= 3) {
    // Simple correlation: days with more sleep -> higher HRV
    const paired = recent.slice(0, 7).map((o) => ({
      asleep: o.asleepMinutes ?? 0,
      hrv: withHrv.find((i) => i.date === o.date)?.hrvMs,
    })).filter((p) => p.hrv !== undefined);
    if (paired.length >= 3) {
      const moreSleep = paired.filter((p) => p.asleep > 420); // >7h
      const lessSleep = paired.filter((p) => p.asleep <= 420);
      if (moreSleep.length > 0 && lessSleep.length > 0) {
        const avgHrvMore = moreSleep.reduce((s, p) => s + p.hrv!, 0) / moreSleep.length;
        const avgHrvLess = lessSleep.reduce((s, p) => s + p.hrv!, 0) / lessSleep.length;
        if (avgHrvMore > avgHrvLess * 1.05) {
          sections.push({
            id: "hrv_correlation",
            priority: 6,
            tone: "insight",
            title: "More sleep → higher HRV",
            body: `Days with 7h+ sleep average ${Math.round(avgHrvMore)}ms HRV vs ${Math.round(avgHrvLess)}ms on shorter nights.`,
          });
        }
      }
    }
  }

  // Consistency
  if (withDuration.length >= 5) {
    const hours = withDuration.map((o) => o.asleepMinutes! / 60);
    const mean = hours.reduce((s, h) => s + h, 0) / hours.length;
    const variance = hours.reduce((s, h) => s + Math.pow(h - mean, 2), 0) / hours.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev > 1.0) {
      sections.push({
        id: "inconsistent",
        priority: 7,
        tone: "insight",
        title: `Sleep consistency: ±${stdDev.toFixed(1)}h`,
        body: "High night-to-night variation. Regular bed/wake times improve recovery.",
      });
    }
  }

  // Trend
  if (withDuration.length >= 6) {
    const firstHalf = withDuration.slice(Math.floor(withDuration.length / 2));
    const secondHalf = withDuration.slice(0, Math.floor(withDuration.length / 2));
    const firstAvg = firstHalf.reduce((s, o) => s + o.asleepMinutes! / 60, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, o) => s + o.asleepMinutes! / 60, 0) / secondHalf.length;
    const diff = secondAvg - firstAvg;
    if (diff > 0.3) {
      sections.push({
        id: "improving_trend",
        priority: 5,
        tone: "quiet",
        title: `Sleep trend: improving (+${diff.toFixed(1)}h)`,
        body: "Recent nights are longer than earlier in the window.",
      });
    } else if (diff < -0.3) {
      sections.push({
        id: "declining_trend",
        priority: 5,
        tone: "intervention",
        title: `Sleep trend: declining (${diff.toFixed(1)}h)`,
        body: "Recent nights are shorter. Address before debt accumulates.",
      });
    }
  }

  if (sections.length === 0) {
    sections.push({
      id: "tracking",
      priority: 0,
      tone: "quiet",
      title: "Tracking sleep",
      body: `${observations.length} observations recorded. Keep logging for insights.`,
    });
  }

  return sections.sort((a, b) => b.priority - a.priority);
}

function minutesToHoursMins(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function SleepScreen() {
  const { userId } = useSession();
  const [dateRange] = useState<{ from: string; to: string }>(() => ({
    from: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!,
    to: new Date().toISOString().split("T")[0]!,
  }));

  const observations = useAsync(async () => {
    if (!userId) return [] as SleepObservation[];
    const res = await endpoints.listSleep(userId, { from: dateRange.from, to: dateRange.to, limit: 50 });
    return res.sleep;
  }, [userId, dateRange.from, dateRange.to]);

  const indicators = useAsync(async () => {
    if (!userId) return [] as RecoveryIndicator[];
    const res = await endpoints.listRecoveryIndicators(userId, { from: dateRange.from, to: dateRange.to, limit: 50 });
    return res.indicators;
  }, [userId, dateRange.from, dateRange.to]);

  const sections = useMemo(() => {
    if (observations.status !== "ready" || indicators.status !== "ready") return [];
    return deriveSleepSections({
      observations: observations.data,
      indicators: indicators.data,
    });
  }, [observations, indicators]);

  const loading = observations.status === "loading" || indicators.status === "loading";
  const error = observations.status === "error" || indicators.status === "error";

  if (!userId) {
    return (
      <div className="fc-screen fc-sleep">
        <section className="fc-screen__hero motion-rise">
          <p className="t-caption t-muted">Sleep</p>
          <h1 className="t-display">Sleep that powers recovery.</h1>
          <p className="t-body t-secondary fc-measure">
            Duration, efficiency, stages — understand your night to own your day.
          </p>
        </section>
      </div>
    );
  }

  if (loading) return <StateBlock kind="loading" title="Loading sleep" />;
  if (error) {
    const err = observations.status === "error" ? observations : indicators.status === "error" ? indicators : null;
    return (
      <StateBlock
        kind="error"
        title="Failed to load sleep"
        body={err?.error?.message}
        action={err ? <Button onClick={err.retry}>Retry</Button> : null}
      />
    );
  }

  const recent = observations.data.slice(0, 7);
  const withDuration = recent.filter((o) => o.asleepMinutes !== undefined && o.asleepMinutes! > 0);
  const avgHours = withDuration.length > 0
    ? withDuration.reduce((s, o) => s + (o.asleepMinutes! / 60), 0) / withDuration.length
    : 0;
  const avgEfficiency = withDuration.filter((o) => o.efficiency !== undefined).length > 0
    ? Math.round(withDuration.filter((o) => o.efficiency !== undefined).reduce((s, o) => s + (o.efficiency ?? 0), 0) / withDuration.filter((o) => o.efficiency !== undefined).length)
    : 0;

  return (
    <div className="fc-screen fc-sleep">
      {/* Hero: Tonight's target & recent avg */}
      <section className="fc-sleep__hero motion-rise" aria-labelledby="sleep-summary">
        <div className="fc-sleep__metrics">
          <article className="fc-metric fc-metric--primary">
            <p className="t-caption t-muted">7-day avg</p>
            <h2 className="t-display fc-metric__value">{avgHours.toFixed(1)}h</h2>
            <p className="t-small t-secondary">Target: 7.5h</p>
          </article>
          <article className="fc-metric">
            <p className="t-caption t-muted">Efficiency</p>
            <h2 className="t-display fc-metric__value">{avgEfficiency > 0 ? avgEfficiency + "%" : "—"}</h2>
            <p className="t-small t-secondary">Target: ≥85%</p>
          </article>
          <article className="fc-metric">
            <p className="t-caption t-muted">Nights logged</p>
            <h2 className="t-display fc-metric__value">{observations.data.length}</h2>
            <p className="t-small t-secondary">Last 14 days</p>
          </article>
        </div>

        <div className="fc-sleep__actions">
          <Link to="/sleep/log" className="fc-link-button">
            <Button size="base">Log sleep</Button>
          </Link>
        </div>
      </section>

      {/* Priority sections */}
      <section className="fc-sleep__sections" aria-label="Sleep insights">
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

      {/* Recent nights list */}
      <section className="fc-sleep__recent">
        <h2 className="t-title">Recent nights</h2>
        <div className="fc-sleep__list">
          {recent.map((night) => (
            <article key={night.id} className="fc-night-card">
              <div className="fc-night-card__date">
                <time dateTime={night.date}>{new Date(night.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</time>
                <span className="fc-night-card__source">{sentence(night.source)}</span>
              </div>
              <div className="fc-night-card__main">
                {night.asleepMinutes !== undefined ? (
                  <>
                    <span className="fc-night-card__duration">{minutesToHoursMins(night.asleepMinutes)}</span>
                    <span className="fc-night-card__label">asleep</span>
                  </>
                ) : (
                  <span className="fc-night-card__duration t-muted">—</span>
                )}
                {night.efficiency !== undefined && (
                  <span className="fc-night-card__efficiency">{night.efficiency}% efficiency</span>
                )}
              </div>
              {night.deepMinutes !== undefined || night.remMinutes !== undefined ? (
                <div className="fc-night-card__stages">
                  {night.deepMinutes !== undefined && (
                    <span className="fc-stage fc-stage--deep">Deep {night.deepMinutes}min</span>
                  )}
                  {night.remMinutes !== undefined && (
                    <span className="fc-stage fc-stage--rem">REM {night.remMinutes}min</span>
                  )}
                  {night.lightMinutes !== undefined && (
                    <span className="fc-stage fc-stage--light">Light {night.lightMinutes}min</span>
                  )}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}