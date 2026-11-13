import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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
  Icon,
} from "../components/controls";
import { api } from "../api";
import { useNavigate } from "react-router-dom";

export function FoodDetailScreen() {
  const navigate = useNavigate();
  const { foodId } = useParams<{ foodId: string }>();

  const { data: food, isLoading, error } = useQuery({
    queryKey: ["foods", foodId],
    queryFn: () => api.get(`/v0/foods/${foodId}`).json(),
    retry: false,
  });

  if (isLoading) {
    return <StateBlock kind="loading" title="Loading food…" />;
  }

  if (error || !food?.food) {
    return (
      <StateBlock
        kind="error"
        title="Food not found"
        body="This food may have been deleted or you don't have access to it."
        action={<Button variant="secondary" onClick={() => navigate("/nutrition")}>Back to nutrition</Button>}
      />
    );
  }

  const f = food.food;
  const defaultServing = f.defaultServingId
    ? f.servings.find((s: { id: string }) => s.id === f.defaultServingId)
    : f.servings[0];

  const nutrientRows = [
    { label: "Calories", value: f.nutrientsPer100g.caloriesKcal, unit: "kcal", color: "primary" },
    { label: "Protein", value: f.nutrientsPer100g.proteinGrams, unit: "g", color: "success" },
    { label: "Carbohydrates", value: f.nutrientsPer100g.carbohydrateGrams, unit: "g", color: "warning" },
    { label: "Fat", value: f.nutrientsPer100g.fatGrams, unit: "g", color: "error" },
    { label: "Fiber", value: f.nutrientsPer100g.fiberGrams, unit: "g", color: "neutral" },
    { label: "Sugars", value: f.nutrientsPer100g.sugarsGrams, unit: "g", color: "warning" },
    { label: "Sodium", value: f.nutrientsPer100g.sodiumMilligrams, unit: "mg", color: "neutral" },
    { label: "Saturated Fat", value: f.nutrientsPer100g.saturatedFatGrams, unit: "g", color: "error" },
    { label: "Cholesterol", value: f.nutrientsPer100g.cholesterolMilligrams, unit: "mg", color: "neutral" },
  ].filter((n) => n.value !== undefined);

  return (
    <Spacing>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <Button variant="ghost" onClick={() => navigate("/nutrition")} style={{ marginRight: 8 }}>
            <Icon name="chevron-left" />
          </Button>
          <Title level={1} style={{ display: "inline" }}>{f.name}</Title>
        </div>
        <Button variant="primary" onClick={() => navigate(`/nutrition/meals/new?foodId=${f.id}`)}>
          <Icon name="plus" /> Log
        </Button>
      </div>

      {f.brand && (
        <Text variant="subtitle" tone="muted" style={{ marginBottom: 16 }}>{f.brand}</Text>
      )}

      {/* Per 100g/ml nutrients */}
      <Card style={{ marginBottom: 16 }}>
        <Title level={2} style={{ marginBottom: 12 }}>Nutrients per 100{f.densityBasis === "per_100ml" ? "ml" : "g"}</Title>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
          {nutrientRows.map((nutrient) => (
            <Card key={nutrient.label} variant="subtle" style={{ padding: 16, textAlign: "center" }}>
              <Text variant="caption" tone="muted" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {nutrient.label}
              </Text>
              <Text variant="heading" style={{ fontSize: 24, marginTop: 4, color: `var(--color-${nutrient.color})` }}>
                {nutrient.value}
                <span style={{ fontSize: 12, fontWeight: 400, color: "var(--color-text-muted)", marginLeft: 4 }}>{nutrient.unit}</span>
              </Text>
            </Card>
          ))}
        </div>
      </Card>

      {/* Servings */}
      <Divider style={{ marginTop: 16, marginBottom: 16 }} />
      <Card style={{ marginBottom: 16 }}>
        <Title level={2} style={{ marginBottom: 12 }}>Servings</Title>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
          {f.servings.map((serving: { id: string; label: string; grams?: number; milliliters?: number; unitQuantity?: number; unitName?: string }) => (
            <Button
              key={serving.id}
              variant={serving.id === f.defaultServingId ? "primary" : "outline"}
              onClick={() => {}}
              style={{ padding: 12, textAlign: "left" }}
            >
              <Text variant="body" style={{ fontWeight: 600 }}>{serving.label}</Text>
              {serving.grams && <Text variant="caption" tone="muted">{serving.grams}g</Text>}
              {serving.milliliters && <Text variant="caption" tone="muted">{serving.milliliters}ml</Text>}
              {serving.unitQuantity && <Text variant="caption" tone="muted">{serving.unitQuantity} {serving.unitName}</Text>}
              {serving.id === f.defaultServingId && (
                <span style={{ marginTop: 4, display: "inline-block" }}><Chip size="sm" tone="accent">Default</Chip></span>
              )}
            </Button>
          ))}
        </div>
      </Card>

      {/* Quick log with serving */}
      {defaultServing && (
        <Card style={{ marginBottom: 16 }}>
          <Title level={2} style={{ marginBottom: 12 }}>Quick Log</Title>
          <QuickLogServing
            foodId={f.id}
            serving={defaultServing}
            nutrientsPer100g={f.nutrientsPer100g}
          />
        </Card>
      )}

      {/* Metadata */}
      <Divider style={{ marginTop: 16, marginBottom: 16 }} />
      <Card>
        <Title level={2} style={{ marginBottom: 12 }}>Details</Title>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <div>
            <Text variant="caption" tone="muted">Source</Text>
            <Text variant="body">{f.sourceId}</Text>
          </div>
          <div>
            <Text variant="caption" tone="muted">Density Basis</Text>
            <Text variant="body">{f.densityBasis.replace("_", " ")}</Text>
          </div>
          <div>
            <Text variant="caption" tone="muted">Created</Text>
            <Text variant="body">{new Date(f.createdAt).toLocaleDateString()}</Text>
          </div>
        </div>
      </Card>
    </Spacing>
  );
}

interface QuickLogServingProps {
  foodId: string;
  serving: { id: string; label: string; grams?: number; milliliters?: number; unitQuantity?: number; unitName?: string };
  nutrientsPer100g: {
    caloriesKcal: number;
    proteinGrams: number;
    carbohydrateGrams: number;
    fatGrams: number;
    fiberGrams?: number;
  };
}

function QuickLogServing({ foodId, serving, nutrientsPer100g }: QuickLogServingProps) {
  const [quantity, setQuantity] = useState(serving.grams || serving.milliliters || 1);

  const factor = serving.grams
    ? quantity / serving.grams
    : serving.milliliters
    ? quantity / serving.milliliters
    : 1;

  const calories = Math.round(nutrientsPer100g.caloriesKcal * factor * (serving.grams || serving.milliliters || 100) / 100);
  const protein = Math.round(nutrientsPer100g.proteinGrams * factor * (serving.grams || serving.milliliters || 100) / 100 * 10) / 10;
  const carbs = Math.round(nutrientsPer100g.carbohydrateGrams * factor * (serving.grams || serving.milliliters || 100) / 100 * 10) / 10;
  const fat = Math.round(nutrientsPer100g.fatGrams * factor * (serving.grams || serving.milliliters || 100) / 100 * 10) / 10;

  return (
    <Spacing>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Text variant="caption" tone="muted" style={{ display: "block", marginBottom: 4 }}>
            {serving.label}
          </Text>
          <Input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(Math.max(0.1, parseFloat(e.target.value) || 0.1))}
            min={0.1}
            max={5000}
            step={serving.grams || serving.milliliters ? 1 : 0.1}
            style={{ width: 100 }}
          />
          <Text variant="caption" tone="muted" style={{ marginLeft: 8 }}>
            {serving.grams || serving.milliliters ? (serving.grams ? "g" : "ml") : serving.unitName}
          </Text>
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Text variant="subtitle" style={{ color: "var(--color-primary)" }}>{calories} kcal</Text>
          <Text variant="caption" tone="muted">P:{protein}g</Text>
          <Text variant="caption" tone="muted">C:{carbs}g</Text>
          <Text variant="caption" tone="muted">F:{fat}g</Text>
        </div>
      </div>
      <Button
        variant="primary"
        onClick={() => {
          window.location.href = `/nutrition/meals/new?foodId=${foodId}&quantity=${quantity}&servingId=${serving.id}`;
        }}
      >
        Log {calories} kcal
      </Button>
    </Spacing>
  );
}