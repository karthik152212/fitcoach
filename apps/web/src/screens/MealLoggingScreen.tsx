import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Card,
  Chip,
  Input,
  Select,
  StateBlock,
  Text,
  Title,
  Spacing,
  Divider,
  Icon,
  Dialog,
} from "../components/controls";
import { api } from "../api";
import { lookupBarcode } from "../api/endpoints";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { ProductPreviewScreen } from "./ProductPreviewScreen";
import type { ScannedProductPreview } from "../api/types";

interface FoodSearchResult {
  id: string;
  name: string;
  brand?: string;
  nutrientsPer100g: {
    caloriesKcal: number;
    proteinGrams: number;
    carbohydrateGrams: number;
    fatGrams: number;
    fiberGrams?: number;
  };
  servings: Array<{
    id: string;
    label: string;
    grams?: number;
    milliliters?: number;
    unitQuantity?: number;
    unitName?: string;
  }>;
  defaultServingId?: string;
}

interface MealItem {
  id: string;
  foodId: string;
  foodName: string;
  quantityGrams: number;
  servingLabel?: string;
  nutrients: {
    caloriesKcal: number;
    proteinGrams: number;
    carbohydrateGrams: number;
    fatGrams: number;
    fiberGrams?: number;
  };
}

export function MealLoggingScreen() {
  const navigate = useNavigate();
  const { mealId } = useParams<{ mealId?: string }>();
  const queryClient = useQueryClient();
  const isEditing = !!mealId;

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFood, setSelectedFood] = useState<FoodSearchResult | null>(null);
  const [items, setItems] = useState<MealItem[]>([]);
  const [localDate, setLocalDate] = useState<string>(() => new Date().toISOString().split("T")[0] ?? "");
  const [slot, setSlot] = useState<"breakfast" | "lunch" | "dinner" | "snack" | "other">("lunch");
  const [quantityGrams, setQuantityGrams] = useState(100);
  const [showServingDialog, setShowServingDialog] = useState(false);
  const [selectedServing, setSelectedServing] = useState<FoodSearchResult["servings"][0] | null>(null);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [scannedProduct, setScannedProduct] = useState<ScannedProductPreview | null>(null);

  // Search foods
  const { data: searchResults, isLoading: searching } = useQuery({
    queryKey: ["foods", "search", searchQuery],
    queryFn: () => api.get(`/v0/foods/search?q=${encodeURIComponent(searchQuery)}&limit=20`).json(),
    enabled: searchQuery.length >= 2,
    staleTime: 30000,
  });

  // Create meal mutation
  const createMealMutation = useMutation({
    mutationFn: async (mealData: {
      localDate: string;
      slot?: string;
      items: Array<{
        foodId: string;
        quantityGrams: number;
        confidence?: "measured" | "label_declared" | "estimated" | "unknown";
        notes?: string;
      }>;
    }) => {
      const response = await api.post("/v0/users/me/meals", mealData).json();
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nutrition", "daily"] });
      queryClient.invalidateQueries({ queryKey: ["meals"] });
      navigate("/nutrition");
    },
  });

  const addItemMutation = useMutation({
    mutationFn: async ({ mealId: mId, item }: { mealId: string; item: MealItem }) => {
      const response = await api.post(`/v0/users/me/meals/${mId}/items`, {
        foodId: item.foodId,
        quantityGrams: item.quantityGrams,
        confidence: "estimated",
      }).json();
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nutrition", "daily"] });
      queryClient.invalidateQueries({ queryKey: ["meals"] });
    },
  });

  const handleFoodSelect = (food: FoodSearchResult) => {
    setSelectedFood(food);
    // Default to default serving or 100g
    const defaultServing = food.defaultServingId
      ? food.servings.find((s) => s.id === food.defaultServingId)
      : undefined;
    if (defaultServing?.grams) {
      setQuantityGrams(defaultServing.grams);
      setSelectedServing(defaultServing);
    } else {
      setQuantityGrams(100);
      setSelectedServing(null);
    }
    setShowServingDialog(true);
  };

  const handleAddItem = () => {
    if (!selectedFood || !selectedServing) return;

    const factor = selectedServing.grams
      ? quantityGrams / selectedServing.grams
      : 1;

    const nutrients = {
      caloriesKcal: Math.round(selectedFood.nutrientsPer100g.caloriesKcal * factor * (selectedServing.grams || 100) / 100),
      proteinGrams: Math.round(selectedFood.nutrientsPer100g.proteinGrams * factor * (selectedServing.grams || 100) / 100 * 10) / 10,
      carbohydrateGrams: Math.round(selectedFood.nutrientsPer100g.carbohydrateGrams * factor * (selectedServing.grams || 100) / 100 * 10) / 10,
      fatGrams: Math.round(selectedFood.nutrientsPer100g.fatGrams * factor * (selectedServing.grams || 100) / 100 * 10) / 10,
      fiberGrams: selectedFood.nutrientsPer100g.fiberGrams
        ? Math.round(selectedFood.nutrientsPer100g.fiberGrams * factor * (selectedServing.grams || 100) / 100 * 10) / 10
        : undefined,
    };

    const newItem: MealItem = {
      id: crypto.randomUUID(),
      foodId: selectedFood.id,
      foodName: selectedFood.name,
      quantityGrams,
      servingLabel: selectedServing.label,
      nutrients,
    };

    if (isEditing && mealId) {
      addItemMutation.mutate({ mealId, item: newItem });
      setItems((prev) => [...prev, newItem]);
    } else {
      setItems((prev) => [...prev, newItem]);
    }

    setSelectedFood(null);
    setSelectedServing(null);
    setQuantityGrams(100);
    setShowServingDialog(false);
    setSearchQuery("");
  };

  const handleRemoveItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleSave = () => {
    if (items.length === 0) return;

    if (isEditing && mealId) {
      // For editing, we'd need a different approach - for now just recreate
      navigate("/nutrition");
    } else {
      createMealMutation.mutate({
        localDate,
        slot: String(slot),
        items: items.map((item) => ({
          foodId: item.foodId,
          quantityGrams: item.quantityGrams,
          confidence: "estimated" as const,
        })),
      });
    }
  };

  const handleBarcodeScan = async (barcode: string, _format: any) => {
    setShowBarcodeScanner(false);
    try {
      // First check if we have this product locally
      const result = await lookupBarcode(barcode).json();
      if (result.found && result.product) {
        // Show product preview
        setScannedProduct(result.product);
        return;
      }

      // If not found locally, show preview screen to fetch from Open Food Facts
      setScannedProduct({
        barcode,
        name: "Loading…",
        brand: "",
        imageUrl: undefined,
        nutrientsPer100g: { caloriesKcal: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 },
        servings: [{ id: "100g", label: "100g", grams: 100 }],
        isFromOpenFoodFacts: true,
        confidence: "low",
        novaGroup: undefined,
        nutriscoreGrade: undefined,
      } as ScannedProductPreview);
    } catch (err) {
      console.error("Barcode lookup failed:", err);
    }
  };

  const handleAddScannedProduct = (product: ScannedProductPreview, servingGrams: number) => {
    const factor = servingGrams / 100;
    const nutrients = {
      caloriesKcal: Math.round((product.nutrientsPer100g.caloriesKcal ?? 0) * factor),
      proteinGrams: Math.round((product.nutrientsPer100g.proteinGrams ?? 0) * factor * 10) / 10,
      carbohydrateGrams: Math.round((product.nutrientsPer100g.carbohydrateGrams ?? 0) * factor * 10) / 10,
      fatGrams: Math.round((product.nutrientsPer100g.fatGrams ?? 0) * factor * 10) / 10,
      fiberGrams: product.nutrientsPer100g.fiberGrams
        ? Math.round(product.nutrientsPer100g.fiberGrams * factor * 10) / 10
        : undefined,
    };

    const newItem: MealItem = {
      id: crypto.randomUUID(),
      foodId: product.barcode,
      foodName: product.name,
      quantityGrams: servingGrams,
      servingLabel: product.servings.find(s => s.grams === servingGrams)?.label || `${servingGrams}g`,
      nutrients,
    };

    if (isEditing && mealId) {
      addItemMutation.mutate({ mealId, item: newItem });
      setItems((prev) => [...prev, newItem]);
    } else {
      setItems((prev) => [...prev, newItem]);
    }

    setScannedProduct(null);
    setSearchQuery("");
  };

  const handleCloseScanner = () => {
    setShowBarcodeScanner(false);
  };

  const handleClosePreview = () => {
    setScannedProduct(null);
  };

  const totals = items.reduce(
    (acc, item) => ({
      caloriesKcal: acc.caloriesKcal + item.nutrients.caloriesKcal,
      proteinGrams: acc.proteinGrams + item.nutrients.proteinGrams,
      carbohydrateGrams: acc.carbohydrateGrams + item.nutrients.carbohydrateGrams,
      fatGrams: acc.fatGrams + item.nutrients.fatGrams,
      fiberGrams: (acc.fiberGrams || 0) + (item.nutrients.fiberGrams || 0),
    }),
    { caloriesKcal: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0, fiberGrams: 0 }
  );

  return (
    <Spacing>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Title level={1}>{isEditing ? "Edit Meal" : "Log Meal"}</Title>
        <Button variant="primary" onClick={handleSave} disabled={items.length === 0 || createMealMutation.isPending}>
          {createMealMutation.isPending ? "Saving…" : isEditing ? "Update" : "Log Meal"}
        </Button>
      </div>

      {/* Meal metadata */}
      <Card style={{ marginBottom: 16, padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <Text variant="caption" tone="muted" style={{ display: "block", marginBottom: 4 }}>Date</Text>
            <Input
              type="date"
              value={localDate}
              onChange={(e) => setLocalDate(e.target.value)}
            />
          </div>
          <div>
            <Text variant="caption" tone="muted" style={{ display: "block", marginBottom: 4 }}>Meal</Text>
            <Select
              value={slot}
              onChange={(e) => setSlot(e.target.value as typeof slot)}
              options={[
                { value: "breakfast", label: "Breakfast" },
                { value: "lunch", label: "Lunch" },
                { value: "dinner", label: "Dinner" },
                { value: "snack", label: "Snack" },
                { value: "other", label: "Other" },
              ]}
            />
          </div>
        </div>
      </Card>

      {/* Search */}
      <Card style={{ marginBottom: 16, padding: 16 }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
          <Input
            placeholder="Search foods… (min 2 characters)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            leftIcon={<Icon name="search" />}
            style={{ flex: 1 }}
          />
          <Button variant="secondary" onClick={() => setShowBarcodeScanner(true)}>
            <Icon name="barcode" style={{ marginRight: 8 }} /> Scan Barcode
          </Button>
        </div>
        {searching && <Text variant="caption" tone="muted" style={{ marginTop: 8 }}>Searching…</Text>}
        {searchResults?.foods && searchResults.foods.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {searchResults.foods.slice(0, 10).map((food: FoodSearchResult) => (
              <Chip
                key={food.id}
                onClick={() => handleFoodSelect(food)}
                tone="neutral"
              >
                {food.brand ? `${food.name} — ${food.brand}` : food.name}
              </Chip>
            ))}
          </div>
        )}
      </Card>

      {/* Serving dialog */}
      <Dialog
        open={showServingDialog}
        onClose={() => setShowServingDialog(false)}
        title={`Add ${selectedFood?.name}`}
        footer={
          <Button variant="primary" onClick={handleAddItem} disabled={!selectedServing}>
            Add {quantityGrams}g
          </Button>
        }
      >
        {selectedFood && (
          <Spacing>
            <Text variant="caption" tone="muted" style={{ display: "block", marginBottom: 8 }}>Select serving</Text>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8 }}>
              {selectedFood.servings.map((serving) => (
                <Button
                  key={serving.id}
                  variant={selectedServing?.id === serving.id ? "primary" : "outline"}
                  onClick={() => {
                    setSelectedServing(serving);
                    if (serving.grams) setQuantityGrams(serving.grams);
                  }}
                  style={{ padding: 8 }}
                >
                  {serving.label}
                  {serving.grams && <Text variant="caption" tone="muted" style={{ display: "block", marginTop: 4 }}>{serving.grams}g</Text>}
                  {serving.milliliters && <Text variant="caption" tone="muted" style={{ display: "block", marginTop: 4 }}>{serving.milliliters}ml</Text>}
                  {serving.unitQuantity && <Text variant="caption" tone="muted" style={{ display: "block", marginTop: 4 }}>{serving.unitQuantity} {serving.unitName}</Text>}
                </Button>
              ))}
              <Button
                variant={!selectedServing || selectedServing?.id === "custom" ? "primary" : "outline"}
                onClick={() => setSelectedServing({ id: "custom", label: "Custom", grams: quantityGrams })}
                style={{ padding: 8 }}
              >
                Custom quantity
              </Button>
            </div>
            {selectedServing && (
              <Input
                type="number"
                label="Quantity (g)"
                value={quantityGrams}
                onChange={(e) => setQuantityGrams(Math.max(1, parseInt(e.target.value) || 1))}
                min={1}
                max={5000}
                style={{ marginTop: 16 }}
              />
            )}
          </Spacing>
        )}
      </Dialog>

      {/* Current items */}
      <Divider style={{ marginTop: 16, marginBottom: 16 }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Title level={2}>Items ({items.length})</Title>
        <Text variant="subtitle" style={{ color: "var(--color-primary)" }}>
          {totals.caloriesKcal} kcal · {totals.proteinGrams}g P · {totals.carbohydrateGrams}g C · {totals.fatGrams}g F
        </Text>
      </div>

      {items.length === 0 ? (
        <StateBlock kind="empty" title="No items yet" body="Search for a food above to add it to your meal" />
      ) : (
        <Spacing>
          {items.map((item) => (
            <Card key={item.id} variant="outline" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <Text variant="body">{item.foodName}</Text>
                <Text variant="caption" tone="muted">
                  {item.servingLabel ? `${item.servingLabel} · ` : ""}{item.quantityGrams}g
                </Text>
              </div>
              <div style={{ textAlign: "right", marginLeft: 16 }}>
                <Text variant="subtitle">{item.nutrients.caloriesKcal} kcal</Text>
                <Text variant="caption" tone="muted">
                  P:{item.nutrients.proteinGrams}g C:{item.nutrients.carbohydrateGrams}g F:{item.nutrients.fatGrams}g
                </Text>
              </div>
              <Button variant="ghost" size="sm" onClick={() => handleRemoveItem(item.id)}>
                <Icon name="trash-2" />
              </Button>
            </Card>
          ))}
        </Spacing>
      )}

      {/* Barcode Scanner Dialog */}
      {showBarcodeScanner && (
        <BarcodeScanner
          onScan={handleBarcodeScan}
          onClose={handleCloseScanner}
        />
      )}

      {/* Product Preview Dialog */}
      {scannedProduct && (
        <ProductPreviewScreen
          barcode={scannedProduct.barcode}
          onClose={handleClosePreview}
          onAddToLog={handleAddScannedProduct}
        />
      )}
    </Spacing>
  );
}