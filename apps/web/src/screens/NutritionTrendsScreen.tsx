import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  StateBlock,
  Text,
  Title,
  Spacing,
  Divider,
  Chip,
} from "../components/controls";
import { api } from "../api";

export function NutritionTrendsScreen() {
  const [windowDays, setWindowDays] = useState(14);

  const { data: assessment, isLoading } = useQuery({
    queryKey: ["nutrition", "assessment", windowDays],
    queryFn: () => api.get(`/v0/users/me/nutrition/assessment?windowDays=${windowDays}`).json(),
    retry: false,
  });

  const { data: targets } = useQuery({
    queryKey: ["nutrition", "targets"],
    queryFn: () => api.get("/v0/users/me/nutrition/targets").json(),
    retry: false,
  });

  if (isLoading) {
    return <StateBlock kind="loading" title="Loading trends…" />;
  }

  if (!assessment?.assessment) {
    return (
      <StateBlock
        kind="empty"
        title="No trend data available"
        body="Log meals for at least a few days to see nutrition trends"
        action={<Button variant="secondary" onClick={() => window.location.href = "/nutrition/meals/new"}>Log Meal</Button>}
      />
    );
  }

  const data = assessment.assessment;
  const trends = data.trends;

  const nutrientConfigs = [
    { key: "calories", label: "Calories", unit: "kcal/day", color: "primary", target: targets?.targets?.caloriesKcal },
    { key: "protein", label: "Protein", unit: "g/day", color: "success", target: targets?.targets?.proteinGrams },
    { key: "carbohydrates", label: "Carbohydrates", unit: "g/day", color: "warning", target: targets?.targets?.carbohydrateGrams },
    { key: "fat", label: "Fat", unit: "g/day", color: "error", target: targets?.targets?.fatGrams },
    { key: "fiber", label: "Fiber", unit: "g/day", color: "neutral", target: targets?.targets?.fiberGrams },
  ] as const;

  return (
    <Spacing>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Title level={1}>Nutrition Trends</Title>
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { days: 7, label: "7d" },
            { days: 14, label: "14d" },
            { days: 30, label: "30d" },
            { days: 90, label: "90d" },
          ].map((w) => (
            <Button
              key={w.days}
              variant={windowDays === w.days ? "primary" : "outline"}
              size="sm"
              onClick={() => setWindowDays(w.days)}
            >
              {w.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <Card style={{ marginBottom: 16 }}>
        <Text variant="body" style={{ whiteSpace: "pre-wrap" }}>{data.summary}</Text>
      </Card>

      {/* Flags */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Chip
            tone={data.flags.calories === "on_track" ? "success" : data.flags.calories === "under" ? "warning" : "error"}
          >
            Calories: {data.flags.calories.replace("_", " ")}
          </Chip>
          <Chip
            tone={data.flags.protein === "on_track" ? "success" : data.flags.protein === "under" ? "warning" : "error"}
          >
            Protein: {data.flags.protein.replace("_", " ")}
          </Chip>
        </div>
      </Card>

      {/* Daily adherence */}
      <Card style={{ marginBottom: 16 }}>
        <Title level={2} style={{ marginBottom: 12 }}>Today's Adherence</Title>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
          {nutrientConfigs
            .filter((n) => n.target !== undefined || (data.dailyAdherence as any)[n.key] !== null)
            .map((nutrient) => {
              const adherence = (data.dailyAdherence as any)[nutrient.key];
              const target = nutrient.target;
              return (
                <Card key={nutrient.key} variant="subtle" style={{ padding: 16, textAlign: "center" }}>
                  <Text variant="caption" tone="muted" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {nutrient.label}
                  </Text>
                  <Text variant="heading" style={{ fontSize: 28, marginTop: 4, color: `var(--color-${nutrient.color})` }}>
                    {adherence !== null ? `${adherence}%` : "—"}
                  </Text>
                  {target !== undefined && (
                    <Text variant="caption" tone={getAdherenceTone(adherence || 0)}>
                      Target: {target}{nutrient.unit.replace("/day", "")}
                    </Text>
                  )}
                </Card>
              );
            })}
        </div>
      </Card>

      {/* Trends */}
      <Divider style={{ marginTop: 16, marginBottom: 16 }} />
      <Title level={2} style={{ marginBottom: 12 }}>Trends ({trends.windowDays}d)</Title>
      <Spacing>
        {nutrientConfigs
          .filter((n) => n.target !== undefined)
          .map((nutrient) => {
            const trend = trends[nutrient.key as keyof typeof trends];
            return (
              <TrendCard key={nutrient.key} nutrient={nutrient} trend={trend} />
            );
          })}
      </Spacing>

      {/* Methodology note */}
      <Divider style={{ marginTop: 24, marginBottom: 16 }} />
      <Card>
        <Title level={3} style={{ marginBottom: 8 }}>Methodology</Title>
        <Text variant="caption" tone="muted">
          Trends are calculated using simple linear regression on daily totals over the selected window.
          Direction is classified as: increasing (positive slope), decreasing (negative slope), or stable (slope near zero).
          Confidence reflects the R² of the fit. "Insufficient data" means fewer than 3 data points.
          Trends describe trajectory, not single-day performance — use adherence for daily feedback.
        </Text>
      </Card>
    </Spacing>
  );
}

function TrendCard({
  nutrient,
  trend,
}: {
  nutrient: { label: string; color: string; unit: string; target?: number };
  trend: { direction: string; slopePerDay: number | null; confidence: number | null; pointsUsed: number; warnings: string[] };
}) {
  const directionLabels: Record<string, { label: string; tone: "success" | "warning" | "error" | "neutral" }> = {
    increasing: { label: "Increasing", tone: nutrient.color === "success" ? "success" : "warning" },
    decreasing: { label: "Decreasing", tone: nutrient.color === "success" ? "warning" : "success" },
    stable: { label: "Stable", tone: "success" },
    insufficient_data: { label: "Insufficient Data", tone: "neutral" },
  };

  const dirInfo = directionLabels[trend.direction] || { label: trend.direction, tone: "neutral" };

  return (
    <Card variant="outline" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <Title level={3} style={{ margin: 0, display: "inline" }}>{nutrient.label}</Title>
          <span style={{ marginLeft: 8 }}><Chip size="sm" tone={dirInfo.tone}>{dirInfo.label}</Chip></span>
        </div>
        {trend.slopePerDay !== null && (
          <Text variant="subtitle" style={{ color: `var(--color-${nutrient.color})`, fontVariant: "tabular-nums" }}>
            {trend.slopePerDay > 0 ? "+" : ""}{trend.slopePerDay.toFixed(1)} {nutrient.unit}
          </Text>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, fontSize: 14 }}>
        <div>
          <Text variant="caption" tone="muted">Data Points</Text>
          <Text variant="body">{trend.pointsUsed}</Text>
        </div>
        <div>
          <Text variant="caption" tone="muted">Confidence</Text>
          <Text variant="body">{trend.confidence !== null ? `${(trend.confidence * 100).toFixed(0)}%` : "—"}</Text>
        </div>
        {nutrient.target !== undefined && trend.slopePerDay !== null && (
          <div>
            <Text variant="caption" tone="muted">Projected 7d Change</Text>
            <Text variant="body" style={{ color: `var(--color-${nutrient.color})` }}>
              {trend.slopePerDay * 7 > 0 ? "+" : ""}{(trend.slopePerDay * 7).toFixed(1)} {nutrient.unit.replace("/day", "")}
            </Text>
          </div>
        )}
      </div>

      {trend.warnings && trend.warnings.length > 0 && (
        <div style={{ marginTop: 12, padding: 8, background: "var(--color-surface-elevated)", borderRadius: 8 }}>
          <Text variant="caption" tone="warning">Note: {trend.warnings.join("; ")}</Text>
        </div>
      )}
    </Card>
  );
}

function getAdherenceTone(adherence: number): "success" | "warning" | "error" | "muted" {
  if (adherence >= 90 && adherence <= 110) return "success";
  if (adherence >= 75 && adherence < 90) return "warning";
  if (adherence > 110 && adherence <= 125) return "warning";
  if (adherence < 75 || adherence > 125) return "error";
  return "muted";
}