import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  Chip,
  StateBlock,
  Text,
  Title,
  Spacing,
  Divider,
  Icon,
} from "../components/controls";
import { api } from "../api";

export function NutritionScreen() {
  const navigate = useNavigate();

  const { data: daily, isLoading: loadingDaily } = useQuery({
    queryKey: ["nutrition", "daily"],
    queryFn: () => api.get("/v0/users/me/nutrition/daily").json(),
    retry: false,
  });

  const { data: targets, isLoading: loadingTargets } = useQuery({
    queryKey: ["nutrition", "targets"],
    queryFn: () => api.get("/v0/users/me/nutrition/targets").json(),
    retry: false,
  });

  const { data: assessment, isLoading: loadingAssessment } = useQuery({
    queryKey: ["nutrition", "assessment"],
    queryFn: () => api.get("/v0/users/me/nutrition/assessment?windowDays=14").json(),
    retry: false,
  });

  const loading = loadingDaily || loadingTargets || loadingAssessment;

  if (loading) {
    return <StateBlock kind="loading" title="Loading nutrition…" />;
  }

  if (!daily?.daily) {
    return (
      <StateBlock
        kind="empty"
        title="No nutrition data yet"
        body="Log your first meal to get started"
        action={<Button variant="secondary" onClick={() => navigate("/nutrition/meals/new")}>Log meal</Button>}
      />
    );
  }

  const totals = daily.daily.totals;
  const targetData = targets?.targets;
  const adherence = assessment?.assessment?.dailyAdherence;

  const macroItems = [
    {
      label: "Calories",
      value: `${totals.caloriesKcal}`,
      target: targetData?.caloriesKcal,
      unit: "kcal",
      adherence: adherence?.calories,
      color: "primary",
    },
    {
      label: "Protein",
      value: `${totals.proteinGrams}`,
      target: targetData?.proteinGrams,
      unit: "g",
      adherence: adherence?.protein,
      color: "success",
    },
    {
      label: "Carbs",
      value: totals.carbohydrateGrams !== undefined ? `${totals.carbohydrateGrams}` : "—",
      target: targetData?.carbohydrateGrams,
      unit: "g",
      adherence: adherence?.carbohydrates,
      color: "warning",
    },
    {
      label: "Fat",
      value: totals.fatGrams !== undefined ? `${totals.fatGrams}` : "—",
      target: targetData?.fatGrams,
      unit: "g",
      adherence: adherence?.fat,
      color: "error",
    },
  ].filter((m) => m.target !== undefined || m.value !== "—");

  return (
    <Spacing>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Title level={1}>Nutrition</Title>
        <Button variant="primary" onClick={() => navigate("/nutrition/meals/new")}>
          <Icon name="plus" /> Log Meal
        </Button>
      </div>

      {/* Daily totals vs targets */}
      <Card>
        <Title level={2} style={{ marginBottom: 16 }}>Today</Title>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
          {macroItems.map((macro) => (
            <Card key={macro.label} variant="subtle" style={{ padding: 16, textAlign: "center" }}>
              <Text variant="caption" tone="muted" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {macro.label}
              </Text>
              <Text variant="heading" style={{ fontSize: 28, marginTop: 4, marginBottom: 4, color: `var(--color-${macro.color})` }}>
                {macro.value}
                <span style={{ fontSize: 14, fontWeight: 400, color: "var(--color-text-muted)", marginLeft: 4 }}>{macro.unit}</span>
              </Text>
              {macro.target !== undefined && macro.adherence !== null && macro.adherence !== undefined && (
                <Text variant="caption" tone={getAdherenceTone(macro.adherence)}>
                  {macro.adherence}% of target ({macro.target}{macro.unit})
                </Text>
              )}
              {macro.target === undefined && macro.value !== "—" && (
                <Text variant="caption" tone="muted">No target set</Text>
              )}
            </Card>
          ))}
        </div>
      </Card>

      {assessment?.assessment && (
        <>
          <Divider style={{ marginTop: 24, marginBottom: 16 }} />
          <Card>
            <Title level={2} style={{ marginBottom: 8 }}>Adherence (14-day trend)</Title>
            <Text variant="body" style={{ marginBottom: 16 }}>{assessment.assessment.summary}</Text>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {[
                { key: "calories", label: "Calories" },
                { key: "protein", label: "Protein" },
              ].map((flag) => {
                const flagValue = assessment.assessment.flags[flag.key as keyof typeof assessment.assessment.flags];
                return (
                  <Chip
                    key={flag.key}
                    tone={flagValue === "on_track" ? "success" : flagValue === "under" ? "warning" : "error"}
                  >
                    {`${flag.label}: ${flagValue.replace("_", " ")}`}
                  </Chip>
                );
              })}
            </div>
          </Card>
        </>
      )}

      <Divider style={{ marginTop: 24, marginBottom: 16 }} />

      {/* Quick actions */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <Button variant="outline" onClick={() => navigate("/nutrition/meals/new")} full>
          <Icon name="utensils" style={{ fontSize: 24, marginBottom: 8, display: "block" }} />
          <Text variant="subtitle">Log Meal</Text>
        </Button>
        <Button variant="outline" onClick={() => navigate("/nutrition/recipes")} full>
          <Icon name="book-open" style={{ fontSize: 24, marginBottom: 8, display: "block" }} />
          <Text variant="subtitle">Recipes</Text>
        </Button>
        <Button variant="outline" onClick={() => navigate("/nutrition/targets")} full>
          <Icon name="target" style={{ fontSize: 24, marginBottom: 8, display: "block" }} />
          <Text variant="subtitle">Targets</Text>
        </Button>
        <Button variant="outline" onClick={() => navigate("/nutrition/trends")} full>
          <Icon name="trending-up" style={{ fontSize: 24, marginBottom: 8, display: "block" }} />
          <Text variant="subtitle">Trends</Text>
        </Button>
      </div>

      <Divider style={{ marginTop: 24, marginBottom: 16 }} />

      {/* Recent meals */}
      {daily.daily.mealIds && daily.daily.mealIds.length > 0 && (
        <>
          <Title level={2} style={{ marginBottom: 12 }}>Recent Meals</Title>
          <Spacing>
            {daily.daily.mealIds.slice(0, 5).map((mealId: string) => (
              <Card key={mealId} variant="outline" style={{ padding: 12 }}>
                <Text variant="body">Meal {mealId.slice(0, 8)}</Text>
                <Text variant="caption" tone="muted">Tap to view details</Text>
              </Card>
            ))}
          </Spacing>
        </>
      )}
    </Spacing>
  );
}

function getAdherenceTone(adherence: number): "success" | "warning" | "error" | "muted" {
  if (adherence >= 90 && adherence <= 110) return "success";
  if (adherence >= 75 && adherence < 90) return "warning";
  if (adherence > 110 && adherence <= 125) return "warning";
  if (adherence < 75 || adherence > 125) return "error";
  return "muted";
}