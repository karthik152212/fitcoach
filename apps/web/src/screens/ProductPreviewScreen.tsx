import { useEffect, useState } from "react";
import type { ScannedProductPreview, NutritionAssessmentForProduct } from "../api/types";
import { Button, Card, Chip, StateBlock, Text, Title, Spacing, Divider, Icon, Dialog, Input } from "../components/controls";

function Details({ children, defaultOpen = true }: { children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="fc-expandable" open={open}>
      <summary className="fc-expandable__summary" onClick={() => setOpen(!open)}>
        <span className="fc-expandable__summary-text">{children}</span>
        <span className="fc-expandable__chevron" aria-hidden="true">›</span>
      </summary>
      <div className="fc-expandable__body">{children}</div>
    </details>
  );
}

interface ProductPreviewScreenProps {
  barcode: string;
  initialServingGrams?: number;
  onClose: () => void;
  onAddToLog: (product: ScannedProductPreview, servingGrams: number) => void;
}

export function ProductPreviewScreen({ barcode, initialServingGrams = 100, onClose, onAddToLog }: ProductPreviewScreenProps) {
  const [preview, setPreview] = useState<NutritionAssessmentForProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [servingGrams, setServingGrams] = useState(initialServingGrams);
  const [selectedServing, setSelectedServing] = useState<ScannedProductPreview["servings"][0] | null>(null);

  useEffect(() => {
    fetchPreview();
  }, [barcode, servingGrams]);

  const fetchPreview = async () => {
    setLoading(true);
    setError(null);
    try {
      // Get userId from session/localStorage
      const userId = localStorage.getItem("fitcoach.userId");
      if (!userId) {
        setError("Please sign in to view personalized nutrition assessment");
        setLoading(false);
        return;
      }

      const result = await fetch(`/v0/barcode/preview?barcode=${encodeURIComponent(barcode)}&servingGrams=${servingGrams}&userId=${encodeURIComponent(userId)}`, {
        headers: { "Content-Type": "application/json" },
      });

      if (!result.ok) {
        throw new Error(`Failed to load product preview: ${result.status}`);
      }

      const data = await result.json();
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load product preview");
    } finally {
      setLoading(false);
    }
  };

  const handleServingChange = (serving: ScannedProductPreview["servings"][0]) => {
    setSelectedServing(serving);
    if (serving.grams) {
      setServingGrams(serving.grams);
    }
  };

  const handleQuantityChange = (value: number) => {
    setServingGrams(Math.max(1, Math.min(5000, value)));
    setSelectedServing(null);
  };

  const handleAddToLog = () => {
    if (preview) {
      onAddToLog(preview.product, servingGrams);
      onClose();
    }
  };

  const handleSkip = () => {
    onClose();
  };

  if (loading) {
    return (
      <Dialog open onClose={onClose} title="Loading Product" footer={<></>}>
        <StateBlock kind="loading" title="Fetching product data…" />
      </Dialog>
    );
  }

  if (error || !preview) {
    return (
      <Dialog open onClose={onClose} title="Product Not Found" footer={<></>}>
        <StateBlock
          kind="error"
          title="Could not load product"
          body={error ?? "This barcode was not found in our database or Open Food Facts."}
          action={<Button variant="primary" onClick={onClose}>Close</Button>}
        />
      </Dialog>
    );
  }

  const { product, assessment } = preview;

  const recommendationLabels: Record<string, string> = {
    add_to_log: "Add to Log",
    consider_alternative: "Consider Alternative",
    skip: "Skip",
  };

  return (
    <Dialog open onClose={onClose} title={product.name} footer={<></>}>
      <div style={{ maxWidth: 520 }}>
        <Spacing>
          {/* Product header */}
          <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
            {product.imageUrl && (
              <img
                src={product.imageUrl}
                alt={product.name}
                style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, flexShrink: 0 }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <Title level={3} style={{ margin: 0, marginBottom: 4 }}>{product.name}</Title>
              {product.brand && <Text variant="body" tone="muted" style={{ display: "block", marginBottom: 8 }}>{product.brand}</Text>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {product.nutriscoreGrade && (
                  <Chip
                    tone={product.nutriscoreGrade === "a" || product.nutriscoreGrade === "b" ? "success" : product.nutriscoreGrade === "c" ? "warning" : "error"}
                    size="sm"
                  >
                    Nutri-Score: {product.nutriscoreGrade.toUpperCase()}
                  </Chip>
                )}
                {product.novaGroup && (
                  <Chip tone={product.novaGroup === 4 ? "error" : product.novaGroup === 3 ? "warning" : "success"} size="sm">
                    NOVA: {product.novaGroup}
                  </Chip>
                )}
                <Chip tone="neutral" size="sm">
                  {product.isFromOpenFoodFacts ? "Open Food Facts" : "Local Database"}
                </Chip>
                <Chip tone={product.confidence === "high" ? "success" : product.confidence === "medium" ? "warning" : "important"} size="sm">
                  {product.confidence} confidence
                </Chip>
              </div>
              <Text variant="caption" tone="muted">Barcode: {product.barcode}</Text>
            </div>
          </div>

          <Divider />

          {/* Serving selector */}
          <div style={{ marginBottom: 16 }}>
            <Text variant="caption" tone="muted" style={{ display: "block", marginBottom: 8 }}>Serving Size</Text>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8 }}>
              {product.servings.map((serving) => (
                <Button
                  key={serving.id}
                  variant={selectedServing?.id === serving.id ? "primary" : "outline"}
                  onClick={() => handleServingChange(serving)}
                  style={{ padding: 8 }}
                >
                  {serving.label}
                  {serving.grams && <Text variant="caption" tone="muted" style={{ display: "block", marginTop: 4 }}>{serving.grams}g</Text>}
                  {serving.milliliters && <Text variant="caption" tone="muted" style={{ display: "block", marginTop: 4 }}>{serving.milliliters}ml</Text>}
                </Button>
              ))}
              <Button
                variant={!selectedServing ? "primary" : "outline"}
                onClick={() => setSelectedServing(null)}
                style={{ padding: 8 }}
              >
                Custom
              </Button>
            </div>
            <Input
              type="number"
              label="Quantity (g)"
              value={servingGrams}
              onChange={(e) => handleQuantityChange(parseInt(e.target.value) || 1)}
              min={1}
              max={5000}
              style={{ marginTop: 12 }}
            />
          </div>

          {/* Assessment summary */}
          <Card variant="subtle" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Title level={3} style={{ margin: 0 }}>Assessment for {servingGrams}g</Title>
              <Chip tone={assessment.recommendation === "add_to_log" ? "success" : assessment.recommendation === "consider_alternative" ? "warning" : "error"}>
                {recommendationLabels[assessment.recommendation]}
              </Chip>
            </div>
            <Text variant="body" style={{ marginBottom: 12 }}>{assessment.reasoning}</Text>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
              {assessment.caloriesPercentOfTarget !== null && (
                <div>
                  <Text variant="caption" tone="muted">Calories</Text>
                  <Text variant="subtitle">{assessment.caloriesPercentOfTarget}%</Text>
                </div>
              )}
              {assessment.proteinPercentOfTarget !== null && (
                <div>
                  <Text variant="caption" tone="muted">Protein</Text>
                  <Text variant="subtitle">{assessment.proteinPercentOfTarget}%</Text>
                </div>
              )}
              {assessment.carbsPercentOfTarget !== null && (
                <div>
                  <Text variant="caption" tone="muted">Carbs</Text>
                  <Text variant="subtitle">{assessment.carbsPercentOfTarget}%</Text>
                </div>
              )}
              {assessment.fatPercentOfTarget !== null && (
                <div>
                  <Text variant="caption" tone="muted">Fat</Text>
                  <Text variant="subtitle">{assessment.fatPercentOfTarget}%</Text>
                </div>
              )}
              {assessment.fiberPercentOfTarget !== null && (
                <div style={{ gridColumn: "span 2" }}>
                  <Text variant="caption" tone="muted">Fiber</Text>
                  <Text variant="subtitle">{assessment.fiberPercentOfTarget}%</Text>
                </div>
              )}
            </div>
          </Card>

          {/* Flags */}
          {assessment.flags.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Title level={3} style={{ marginBottom: 12 }}>Nutrition Flags</Title>
              <Spacing>
                {assessment.flags.map((flag, index) => (
                  <Card key={index} variant="outline" style={{ padding: 12, display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <Icon
                      name={
                        flag.severity === "alert" ? "alert" :
                        flag.severity === "warning" ? "info" : "info"
                      }
                      style={{
                        color:
                          flag.severity === "alert" ? "var(--fc-error)" :
                          flag.severity === "warning" ? "var(--fc-warning)" : "var(--fc-info)",
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    />
                    <Text variant="body" style={{ flex: 1 }}>{flag.message}</Text>
                  </Card>
                ))}
              </Spacing>
            </div>
          )}

          {/* Nutrients detail */}
          <Details>
            <Title level={3} style={{ marginBottom: 12 }}>Nutrients per {servingGrams}g</Title>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
              <div>
                <Text variant="caption" tone="muted">Calories</Text>
                <Text variant="body">{Math.round((preview.product.nutrientsPer100g.caloriesKcal ?? 0) * servingGrams / 100)} kcal</Text>
              </div>
              <div>
                <Text variant="caption" tone="muted">Protein</Text>
                <Text variant="body">{Math.round((preview.product.nutrientsPer100g.proteinGrams ?? 0) * servingGrams / 100 * 10) / 10}g</Text>
              </div>
              <div>
                <Text variant="caption" tone="muted">Carbohydrates</Text>
                <Text variant="body">{Math.round((preview.product.nutrientsPer100g.carbohydrateGrams ?? 0) * servingGrams / 100 * 10) / 10}g</Text>
              </div>
              <div>
                <Text variant="caption" tone="muted">Fat</Text>
                <Text variant="body">{Math.round((preview.product.nutrientsPer100g.fatGrams ?? 0) * servingGrams / 100 * 10) / 10}g</Text>
              </div>
              {preview.product.nutrientsPer100g.fiberGrams !== undefined && (
                <>
                  <div>
                    <Text variant="caption" tone="muted">Fiber</Text>
                    <Text variant="body">{Math.round(preview.product.nutrientsPer100g.fiberGrams! * servingGrams / 100 * 10) / 10}g</Text>
                  </div>
                  <div>
                    <Text variant="caption" tone="muted">Sugars</Text>
                    <Text variant="body">{preview.product.nutrientsPer100g.sugarsGrams !== undefined
                      ? Math.round(preview.product.nutrientsPer100g.sugarsGrams * servingGrams / 100 * 10) / 10 + "g"
                      : "—"}</Text>
                  </div>
                </>
              )}
              {preview.product.nutrientsPer100g.sodiumMilligrams !== undefined && (
                <div>
                  <Text variant="caption" tone="muted">Sodium</Text>
                  <Text variant="body">{Math.round(preview.product.nutrientsPer100g.sodiumMilligrams * servingGrams / 100)}mg</Text>
                </div>
              )}
              {preview.product.nutrientsPer100g.saturatedFatGrams !== undefined && (
                <div>
                  <Text variant="caption" tone="muted">Saturated Fat</Text>
                  <Text variant="body">{Math.round(preview.product.nutrientsPer100g.saturatedFatGrams * servingGrams / 100 * 10) / 10}g</Text>
                </div>
              )}
            </div>
          </Details>

          {product.ingredients && (
            <Details defaultOpen={false}>
              <Title level={3} style={{ marginBottom: 8 }}>Ingredients</Title>
              <Text variant="body" tone="muted" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{product.ingredients}</Text>
            </Details>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 12, marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--color-border)" }}>
            <Button variant="primary" onClick={handleAddToLog} style={{ flex: 1 }}>
              {recommendationLabels[assessment.recommendation]}
            </Button>
            <Button variant="ghost" onClick={handleSkip} style={{ flex: 1 }}>
              Skip
            </Button>
          </div>
        </Spacing>
      </div>
    </Dialog>
  );
}