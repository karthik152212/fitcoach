import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  Chip,
  Input,
  StateBlock,
  Text,
  Title,
  Spacing,
  Divider,
  Select,
  Dialog,
} from "../components/controls";
import { api } from "../api";

const GOALS = [
  { value: "bodybuilding", label: "Bodybuilding" },
  { value: "aesthetics_v_taper", label: "Aesthetics / V-Taper" },
  { value: "lean_recomposition", label: "Lean Recomposition" },
  { value: "athletic_performance", label: "Athletic Performance" },
  { value: "max_strength", label: "Max Strength" },
  { value: "general_fitness", label: "General Fitness" },
  { value: "custom", label: "Custom" },
] as const;

export function NutritionTargetsScreen() {
  const queryClient = useQueryClient();

  const { data: targets, isLoading: loadingTargets } = useQuery({
    queryKey: ["nutrition", "targets"],
    queryFn: () => api.get("/v0/users/me/nutrition/targets").json(),
    retry: false,
  });

  const { data: profile, isLoading: loadingProfile } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.get("/v0/users/me/profile").json(),
    retry: false,
  });

  const [goal, setGoal] = useState<typeof GOALS[number]["value"]>("general_fitness");
  const [currentBodyWeightKg, setCurrentBodyWeightKg] = useState("");
  const [bodyFatPercent, setBodyFatPercent] = useState("");
  const [showDeriveDialog, setShowDeriveDialog] = useState(false);

  const deriveMutation = useMutation({
    mutationFn: (data: { goal: string; currentBodyWeightKg?: number; bodyFatPercent?: number }) =>
      api.post("/v0/users/me/nutrition/targets", data).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nutrition", "targets"] });
      queryClient.invalidateQueries({ queryKey: ["nutrition", "daily"] });
      queryClient.invalidateQueries({ queryKey: ["nutrition", "assessment"] });
      setShowDeriveDialog(false);
    },
  });

  const loading = loadingTargets || loadingProfile;

  if (loading) {
    return <StateBlock kind="loading" title="Loading targets…" />;
  }

  const targetData = targets?.targets;

  const handleDerive = () => {
    deriveMutation.mutate({
      goal,
      currentBodyWeightKg: currentBodyWeightKg ? parseFloat(currentBodyWeightKg) : undefined,
      bodyFatPercent: bodyFatPercent ? parseFloat(bodyFatPercent) : undefined,
    });
  };

  return (
    <Spacing>
      <Title level={1} style={{ marginBottom: 16 }}>Nutrition Targets</Title>

      {/* Current targets */}
      {targetData && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <Title level={2}>Current Targets</Title>
            <Chip size="sm" tone="success">Active</Chip>
          </div>

          {targetData.basisNote && (
            <Text variant="caption" tone="muted" style={{ marginBottom: 16, fontStyle: "italic" }}>
              {targetData.basisNote}
            </Text>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            <TargetCard label="Calories" value={targetData.caloriesKcal} unit="kcal" color="primary" />
            <TargetCard label="Protein" value={targetData.proteinGrams} unit="g" color="success" />
            {targetData.carbohydrateGrams !== undefined && (
              <TargetCard label="Carbs" value={targetData.carbohydrateGrams} unit="g" color="warning" />
            )}
            {targetData.fatGrams !== undefined && (
              <TargetCard label="Fat" value={targetData.fatGrams} unit="g" color="error" />
            )}
            {targetData.fiberGrams !== undefined && (
              <TargetCard label="Fiber" value={targetData.fiberGrams} unit="g" color="neutral" />
            )}
          </div>

          <Text variant="caption" tone="muted" style={{ marginTop: 12 }}>
            Effective from {new Date(targetData.effectiveFrom).toLocaleDateString()}
          </Text>
        </Card>
      )}

      {!targetData && (
        <StateBlock
          kind="empty"
          title="No targets set"
          body="Derive personalized targets based on your profile and goal"
          action={<Button variant="secondary" onClick={() => setShowDeriveDialog(true)}>Derive Targets</Button>}
        />
      )}

      {/* Derive targets dialog */}
      <Dialog
        open={showDeriveDialog}
        onClose={() => setShowDeriveDialog(false)}
        title={targetData ? "Update Targets" : "Derive Targets"}
        footer={
          <Button variant="primary" onClick={handleDerive} disabled={deriveMutation.isPending}>
            {deriveMutation.isPending ? "Calculating…" : targetData ? "Update" : "Derive"}
          </Button>
        }
      >
        <Spacing>
          <Select
            label="Goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value as typeof goal)}
            options={GOALS.map((g) => ({ value: g.value, label: g.label }))}
            style={{ marginBottom: 16 }}
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <Input
              type="number"
              label="Current Weight (kg)"
              value={currentBodyWeightKg}
              onChange={(e) => setCurrentBodyWeightKg(e.target.value)}
              placeholder={profile?.profile?.bodyWeightKg?.toString() || "Optional"}
              min={30}
              max={300}
              step={0.1}
              style={{ width: "100%" }}
            />
            <Input
              type="number"
              label="Body Fat % (optional)"
              value={bodyFatPercent}
              onChange={(e) => setBodyFatPercent(e.target.value)}
              placeholder="Optional"
              min={0}
              max={60}
              step={0.1}
              style={{ width: "100%" }}
            />
          </div>

          <Text variant="caption" tone="muted">
            Targets are calculated using your profile (age, height, sex, activity level) and goal.
            Providing current weight and body fat % improves accuracy.
          </Text>
        </Spacing>
      </Dialog>

      {/* Explanation */}
      <Divider style={{ marginTop: 24, marginBottom: 16 }} />
      <Card>
        <Title level={2} style={{ marginBottom: 12 }}>How Targets Are Calculated</Title>
        <div style={{ display: "grid", gap: 12 }}>
          <ExplanationItem
            title="BMR (Basal Metabolic Rate)"
            description="Calculated via Mifflin-St Jeor equation using your age, height, sex, and weight. If body fat % is provided, Katch-McArdle formula is used for lean mass precision."
          />
          <ExplanationItem
            title="Activity Level"
            description="Detected from your 14-day step average and weekly cardio minutes. Ranges from sedentary (< 4k steps) to very active (> 12k steps + cardio)."
          />
          <ExplanationItem
            title="TDEE (Total Daily Energy Expenditure)"
            description="BMR × activity multiplier. This is your maintenance calorie level."
          />
          <ExplanationItem
            title="Goal Adjustment"
            description="Each goal applies a specific deficit/surplus: bodybuilding +15%, recomposition -20%, general fitness -15%, etc."
          />
          <ExplanationItem
            title="Protein Target"
            description="Set per kg bodyweight by goal: 1.8–2.4 g/kg. Higher for lean recomposition and bodybuilding."
          />
          <ExplanationItem
            title="Fat Target"
            description="Percentage of calories by goal: 20–35%. Remaining calories go to carbohydrates."
          />
          <ExplanationItem
            title="Fiber Target"
            description="14 g per 1000 kcal (standard recommendation)."
          />
          <ExplanationItem
            title="Safety Floors"
            description="Calories never below 100% BMR. Surplus capped at 20% TDEE. Protein minimum 1.2 g/kg."
          />
        </div>
      </Card>
    </Spacing>
  );
}

function TargetCard({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <Card variant="subtle" style={{ padding: 16, textAlign: "center" }}>
      <Text variant="caption" tone="muted" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </Text>
      <Text variant="heading" style={{ fontSize: 28, marginTop: 4, color: `var(--color-${color})` }}>
        {value} <span style={{ fontSize: 14, fontWeight: 400, color: "var(--color-text-muted)", marginLeft: 4 }}>{unit}</span>
      </Text>
    </Card>
  );
}

function ExplanationItem({ title, description }: { title: string; description: string }) {
  return (
    <Card variant="subtle" style={{ padding: 12 }}>
      <Text variant="subtitle" style={{ marginBottom: 4 }}>{title}</Text>
      <Text variant="body" tone="muted">{description}</Text>
    </Card>
  );
}