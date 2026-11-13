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
  Icon,
  Dialog,
} from "../components/controls";
import { api } from "../api";

interface Recipe {
  id: string;
  name: string;
  servings: number;
  instructions?: string;
  items: Array<{
    id: string;
    foodId: string;
    foodName: string;
    quantityGrams: number;
    notes?: string;
  }>;
  createdAt: string;
}

interface RecipeNutrition {
  caloriesKcal: number;
  proteinGrams: number;
  carbohydrateGrams: number;
  fatGrams: number;
  fiberGrams?: number;
}

export function RecipeScreen() {
  const queryClient = useQueryClient();

  const { data: recipes, isLoading } = useQuery({
    queryKey: ["recipes"],
    queryFn: () => api.get("/v0/users/me/recipes").json(),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; servings: number; instructions?: string; items: Array<{ foodId: string; quantityGrams: number; notes?: string }> }) =>
      api.post("/v0/users/me/recipes", data).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipes"] });
      setShowCreateDialog(false);
      resetCreateForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (recipeId: string) => api.delete(`/v0/recipes/${recipeId}`).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipes"] });
    },
  });

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newRecipeName, setNewRecipeName] = useState("");
  const [newRecipeServings, setNewRecipeServings] = useState(4);
  const [newRecipeInstructions, setNewRecipeInstructions] = useState("");
  const [recipeItems, setRecipeItems] = useState<Array<{ foodId: string; foodName: string; quantityGrams: number; notes?: string }>>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddItemDialog, setShowAddItemDialog] = useState(false);
  const [selectedFoodForRecipe, setSelectedFoodForRecipe] = useState<any>(null);
  const [selectedServingForRecipe, setSelectedServingForRecipe] = useState<any>(null);
  const [quantityForRecipe, setQuantityForRecipe] = useState(100);

  // Search foods for recipe
  const { data: searchResults, isLoading: searching } = useQuery({
    queryKey: ["foods", "search", searchQuery],
    queryFn: () => api.get(`/v0/foods/search?q=${encodeURIComponent(searchQuery)}&limit=20`).json(),
    enabled: searchQuery.length >= 2,
    staleTime: 30000,
  });

  const resetCreateForm = () => {
    setNewRecipeName("");
    setNewRecipeServings(4);
    setNewRecipeInstructions("");
    setRecipeItems([]);
    setSearchQuery("");
    setShowAddItemDialog(false);
    setSelectedFoodForRecipe(null);
    setSelectedServingForRecipe(null);
    setQuantityForRecipe(100);
  };

  const handleCreate = () => {
    if (!newRecipeName || recipeItems.length === 0) return;
    createMutation.mutate({
      name: newRecipeName,
      servings: newRecipeServings,
      instructions: newRecipeInstructions || undefined,
      items: recipeItems.map((item) => ({
        foodId: item.foodId,
        quantityGrams: item.quantityGrams,
        notes: item.notes,
      })),
    });
  };

  const handleFoodSelectForRecipe = (food: any) => {
    setSelectedFoodForRecipe(food);
    const defaultServing = food.defaultServingId
      ? food.servings.find((s: any) => s.id === food.defaultServingId)
      : food.servings[0];
    if (defaultServing?.grams) {
      setQuantityForRecipe(defaultServing.grams);
      setSelectedServingForRecipe(defaultServing);
    } else {
      setQuantityForRecipe(100);
      setSelectedServingForRecipe(defaultServing);
    }
    setShowAddItemDialog(true);
  };

  const handleAddItem = () => {
    if (!selectedFoodForRecipe || !selectedServingForRecipe) return;

    setRecipeItems((prev) => [
      ...prev,
      {
        foodId: selectedFoodForRecipe.id,
        foodName: selectedFoodForRecipe.name,
        quantityGrams: quantityForRecipe,
      },
    ]);

    setSelectedFoodForRecipe(null);
    setSelectedServingForRecipe(null);
    setQuantityForRecipe(100);
    setShowAddItemDialog(false);
    setSearchQuery("");
  };

  if (isLoading) {
    return <StateBlock kind="loading" title="Loading recipes…" />;
  }

  return (
    <Spacing>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Title level={1}>Recipes</Title>
        <Button variant="primary" onClick={() => { resetCreateForm(); setShowCreateDialog(true); }}>
          <Icon name="plus" /> Create Recipe
        </Button>
      </div>

      {recipes?.recipes && recipes.recipes.length > 0 ? (
        <Spacing>
          {recipes.recipes.map((recipe: Recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} onDelete={deleteMutation.mutate} />
          ))}
        </Spacing>
      ) : (
        <StateBlock
          kind="empty"
          title="No recipes yet"
          body="Create your first recipe to save time logging meals"
          action={<Button variant="secondary" onClick={() => { resetCreateForm(); setShowCreateDialog(true); }}>Create Recipe</Button>}
        />
      )}

      {/* Create Recipe Dialog */}
      <Dialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        title="Create Recipe"
        footer={
          <Button variant="primary" onClick={handleCreate} disabled={createMutation.isPending || !newRecipeName || recipeItems.length === 0}>
            {createMutation.isPending ? "Creating…" : "Create Recipe"}
          </Button>
        }
      >
        <Spacing>
          <Input
            label="Recipe Name"
            value={newRecipeName}
            onChange={(e) => setNewRecipeName(e.target.value)}
            placeholder="e.g., Chicken Curry"
            style={{ marginBottom: 12 }}
          />
          <Input
            type="number"
            label="Servings"
            value={newRecipeServings}
            onChange={(e) => setNewRecipeServings(Math.max(1, parseInt(e.target.value) || 1))}
            min={1}
            max={100}
            style={{ marginBottom: 12, width: 100 }}
          />
          <Input
            label="Instructions (optional)"
            value={newRecipeInstructions}
            onChange={(e) => setNewRecipeInstructions(e.target.value)}
            placeholder="Cooking instructions…"
            multiline
            rows={3}
            style={{ marginBottom: 16 }}
          />

          <Divider />

          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <Title level={3}>Ingredients ({recipeItems.length})</Title>
            <Button variant="secondary" size="sm" onClick={() => setShowAddItemDialog(true)}>
              <Icon name="plus" /> Add Ingredient
            </Button>
          </div>

          {recipeItems.length === 0 ? (
            <Text variant="body" tone="muted" style={{ textAlign: "center", padding: 24 }}>
              No ingredients yet. Add at least one to create the recipe.
            </Text>
          ) : (
            <Spacing>
              {recipeItems.map((item, index) => (
                <Card key={item.foodId + index} variant="outline" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <Text variant="body">{item.foodName}</Text>
                    <Text variant="caption" tone="muted">{item.quantityGrams}g</Text>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setRecipeItems((prev) => prev.filter((_, i) => i !== index))}>
                    <Icon name="trash-2" />
                  </Button>
                </Card>
              ))}
            </Spacing>
          )}
        </Spacing>
      </Dialog>

      {/* Add Item to Recipe Dialog */}
      <Dialog
        open={showAddItemDialog}
        onClose={() => { setShowAddItemDialog(false); setSearchQuery(""); setSelectedFoodForRecipe(null); setSelectedServingForRecipe(null); }}
        title="Add Ingredient"
        footer={
          <Button variant="primary" onClick={handleAddItem} disabled={!selectedFoodForRecipe || !selectedServingForRecipe}>
            Add {quantityForRecipe}g
          </Button>
        }
      >
        <Spacing>
          <Input
            placeholder="Search foods…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            leftIcon={<Icon name="search" />}
            style={{ width: "100%", marginBottom: 12 }}
          />
          {searching && <Text variant="caption" tone="muted" style={{ marginBottom: 8 }}>Searching…</Text>}
          {searchResults?.foods && searchResults.foods.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              {searchResults.foods.slice(0, 10).map((food: any) => (
                <Chip
                  key={food.id}
                  onClick={() => handleFoodSelectForRecipe(food)}
                  tone="neutral"
                >
                  {food.brand ? `${food.name} — ${food.brand}` : food.name}
                </Chip>
              ))}
            </div>
          )}
          {selectedFoodForRecipe && selectedServingForRecipe && (
            <div>
              <Text variant="caption" tone="muted" style={{ display: "block", marginBottom: 8 }}>Quantity: {quantityForRecipe}g ({selectedServingForRecipe.label})</Text>
              <Input
                type="number"
                label="Adjust quantity (g)"
                value={quantityForRecipe}
                onChange={(e) => setQuantityForRecipe(Math.max(1, parseInt(e.target.value) || 1))}
                min={1}
                max={5000}
              />
            </div>
          )}
        </Spacing>
      </Dialog>
    </Spacing>
  );
}

function RecipeCard({ recipe, onDelete }: { recipe: Recipe; onDelete: (id: string) => void }) {
  const [showNutrition, setShowNutrition] = useState(false);
  const [nutrition, setNutrition] = useState<RecipeNutrition | null>(null);

  const { data: nutritionData } = useQuery({
    queryKey: ["recipe-nutrition", recipe.id, 1],
    queryFn: () => api.get(`/v0/recipes/${recipe.id}/nutrition?servings=1`).json(),
    enabled: showNutrition,
  });

  if (nutritionData?.nutrition) {
    setNutrition(nutritionData.nutrition);
  }

  return (
    <Card variant="outline" style={{ marginBottom: 12, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Title level={2} style={{ margin: 0 }}>{recipe.name}</Title>
            <Chip size="sm">{`${recipe.servings} servings`}</Chip>
          </div>
          <Text variant="caption" tone="muted">{recipe.items.length} ingredients</Text>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" size="sm" onClick={() => setShowNutrition(!showNutrition)}>
            {showNutrition ? "Hide" : "Show"} Nutrition
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onDelete(recipe.id)}>
            <Icon name="trash-2" />
          </Button>
        </div>
      </div>

      {showNutrition && nutrition && (
        <>
          <Divider style={{ marginTop: 12, marginBottom: 12 }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <StatBox label="Calories" value={nutrition.caloriesKcal} unit="kcal" color="primary" />
            <StatBox label="Protein" value={nutrition.proteinGrams} unit="g" color="success" />
            <StatBox label="Carbs" value={nutrition.carbohydrateGrams} unit="g" color="warning" />
            <StatBox label="Fat" value={nutrition.fatGrams} unit="g" color="error" />
          </div>
        </>
      )}

      {recipe.instructions && (
        <>
          <Divider style={{ marginTop: 12, marginBottom: 12 }} />
          <Text variant="body" style={{ whiteSpace: "pre-wrap" }}>{recipe.instructions}</Text>
        </>
      )}
    </Card>
  );
}

function StatBox({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <Card variant="subtle" style={{ padding: 12, textAlign: "center" }}>
      <Text variant="caption" tone="muted" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </Text>
      <Text variant="heading" style={{ fontSize: 20, marginTop: 4, color: `var(--color-${color})` }}>
        {value} <span style={{ fontSize: 12, fontWeight: 400, color: "var(--color-text-muted)" }}>{unit}</span>
      </Text>
    </Card>
  );
}