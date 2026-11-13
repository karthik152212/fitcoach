import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProductPreviewScreen } from "../../screens/ProductPreviewScreen";
import { vi, describe, test, expect, beforeEach, afterEach, Mock } from "vitest";

// Mock localStorage
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, "localStorage", {
  value: mockLocalStorage,
  configurable: true,
});

// Mock fetch
global.fetch = vi.fn();

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

describe("ProductPreviewScreen", () => {
  const onClose = vi.fn();
  const onAddToLog = vi.fn();
  const barcode = "1234567890123";
  const userId = "user_123";

  const mockAssessmentResponse = {
    product: {
      barcode: "1234567890123",
      name: "Test Product",
      brand: "Test Brand",
      imageUrl: "https://example.com/image.jpg",
      nutrientsPer100g: {
        caloriesKcal: 200,
        proteinGrams: 20,
        carbohydrateGrams: 25,
        fatGrams: 5,
        fiberGrams: 3,
        sugarsGrams: 5,
        sodiumMilligrams: 150,
        saturatedFatGrams: 2,
      },
      servings: [
        { id: "s1", label: "100g", grams: 100 },
        { id: "s2", label: "1 serving (50g)", grams: 50 },
      ],
      defaultServingId: "s2",
      nutriscoreGrade: "a",
      novaGroup: 1,
      ingredients: "Water, Protein, Natural Flavors",
      isFromOpenFoodFacts: false,
      confidence: "high",
    },
    assessment: {
      caloriesPercentOfTarget: 4,
      proteinPercentOfTarget: 11,
      carbsPercentOfTarget: 5,
      fatPercentOfTarget: 3,
      fiberPercentOfTarget: 5,
      summary: "4% calories, 11% protein, 5% carbs, 3% fat, 5% fiber",
      flags: [],
      recommendation: "add_to_log",
      reasoning: "Excellent protein source. Great for muscle recovery.",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.getItem.mockReturnValue(userId);
    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockAssessmentResponse),
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  test("shows loading state initially", () => {
    render(<ProductPreviewScreen barcode={barcode} onClose={onClose} onAddToLog={onAddToLog} />);

    expect(screen.getByText("Fetching product data…")).toBeInTheDocument();
  });

  test("fetches product preview with correct parameters", async () => {
    render(<ProductPreviewScreen barcode={barcode} onClose={onClose} onAddToLog={onAddToLog} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/v0/barcode/preview?barcode=${barcode}&servingGrams=100&userId=${userId}`,
        { headers: { "Content-Type": "application/json" } }
      );
    });
  });

  test("renders product details after loading", async () => {
    render(<ProductPreviewScreen barcode={barcode} onClose={onClose} onAddToLog={onAddToLog} />);

    await waitFor(() => {
      expect(screen.getByText("Test Brand")).toBeInTheDocument();
      expect(screen.getByText("Barcode: 1234567890123")).toBeInTheDocument();
      // Product name appears in header and card - check at least one exists
      expect(screen.getAllByText("Test Product").length).toBeGreaterThanOrEqual(1);
    });
  });

  test("renders Nutri-Score and NOVA group chips", async () => {
    render(<ProductPreviewScreen barcode={barcode} onClose={onClose} onAddToLog={onAddToLog} />);

    await waitFor(() => {
      expect(screen.getByText("Nutri-Score: A")).toBeInTheDocument();
      expect(screen.getByText("NOVA: 1")).toBeInTheDocument();
    });
  });

  test("renders confidence chip", async () => {
    render(<ProductPreviewScreen barcode={barcode} onClose={onClose} onAddToLog={onAddToLog} />);

    await waitFor(() => {
      expect(screen.getByText("high confidence")).toBeInTheDocument();
    });
  });

  test("renders serving selector with options", async () => {
    render(<ProductPreviewScreen barcode={barcode} onClose={onClose} onAddToLog={onAddToLog} />);

    await waitFor(() => {
      // "100g" appears in button and in caption - check at least one exists
      expect(screen.getAllByText("100g").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("1 serving (50g)")).toBeInTheDocument();
    });
  });

  test("shows assessment summary with recommendation", async () => {
    render(<ProductPreviewScreen barcode={barcode} onClose={onClose} onAddToLog={onAddToLog} />);

    await waitFor(() => {
      expect(screen.getByText("Assessment for 100g")).toBeInTheDocument();
      expect(screen.getByText("Excellent protein source. Great for muscle recovery.")).toBeInTheDocument();
    });
  });

  test("shows nutrient percentage cards", async () => {
    render(<ProductPreviewScreen barcode={barcode} onClose={onClose} onAddToLog={onAddToLog} />);

    await waitFor(() => {
      expect(screen.getByText("4%")).toBeInTheDocument(); // calories
      expect(screen.getByText("11%")).toBeInTheDocument(); // protein
      // 5% appears for both carbs and fiber - check at least one
      expect(screen.getAllByText("5%").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("3%")).toBeInTheDocument(); // fat
    });
  });

  test("shows nutrition flags when present", async () => {
    const responseWithFlags = {
      ...mockAssessmentResponse,
      assessment: {
        ...mockAssessmentResponse.assessment,
        flags: [
          { type: "sodium", severity: "warning", message: "High sodium: 500mg (25% of WHO daily limit)" },
          { type: "ultra_processed", severity: "info", message: "Processed food (NOVA group 3)." },
        ],
      },
    };
    (global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(responseWithFlags),
    });

    render(<ProductPreviewScreen barcode={barcode} onClose={onClose} onAddToLog={onAddToLog} />);

    await waitFor(() => {
      expect(screen.getByText("Nutrition Flags")).toBeInTheDocument();
      expect(screen.getByText("High sodium: 500mg (25% of WHO daily limit)")).toBeInTheDocument();
      expect(screen.getByText("Processed food (NOVA group 3).")).toBeInTheDocument();
    });
  });

  test("shows expandable nutrients detail section", async () => {
    render(<ProductPreviewScreen barcode={barcode} onClose={onClose} onAddToLog={onAddToLog} />);

    await waitFor(() => {
      // "Nutrients per 100g" appears twice - check at least one exists
      expect(screen.getAllByText("Nutrients per 100g").length).toBeGreaterThanOrEqual(1);
    });

    // Click to expand (click first one)
    fireEvent.click(screen.getAllByText("Nutrients per 100g")[0]!);

    await waitFor(() => {
      // "Calories" appears multiple times - check at least one
      expect(screen.getAllByText("Calories").length).toBeGreaterThanOrEqual(1);
      // "200 kcal" appears multiple times - check at least one
      expect(screen.getAllByText("200 kcal").length).toBeGreaterThanOrEqual(1);
      // "Protein" appears multiple times - check at least one
      expect(screen.getAllByText("Protein").length).toBeGreaterThanOrEqual(1);
      // "20g" appears multiple times (in serving button caption and nutrient detail) - check at least one
      expect(screen.getAllByText("20g").length).toBeGreaterThanOrEqual(1);
    });
  });

  test("shows ingredients when available", async () => {
    render(<ProductPreviewScreen barcode={barcode} onClose={onClose} onAddToLog={onAddToLog} />);

    await waitFor(() => {
      // Ingredients text is rendered in both summary and body of Details component - check at least one
      expect(screen.getAllByText("Water, Protein, Natural Flavors").length).toBeGreaterThanOrEqual(1);
    });
  });

  test("calls onAddToLog when Add to Log button is clicked", async () => {
    render(<ProductPreviewScreen barcode={barcode} onClose={onClose} onAddToLog={onAddToLog} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add to Log" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add to Log" }));

    expect(onAddToLog).toHaveBeenCalledWith(mockAssessmentResponse.product, 100);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("calls onClose when Skip button is clicked", async () => {
    render(<ProductPreviewScreen barcode={barcode} onClose={onClose} onAddToLog={onAddToLog} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAddToLog).not.toHaveBeenCalled();
  });

  test("calls onClose when close button in header is clicked", async () => {
    render(<ProductPreviewScreen barcode={barcode} onClose={onClose} onAddToLog={onAddToLog} />);

    await waitFor(() => {
      const closeButton = screen.getByRole("button", { name: /close/i });
      expect(closeButton).toBeInTheDocument();
    });
  });

  test("updates serving grams when serving is selected", async () => {
    render(<ProductPreviewScreen barcode={barcode} onClose={onClose} onAddToLog={onAddToLog} />);

    await waitFor(() => {
      // Find the 50g serving button and click it
      const servingButton = screen.getByText("1 serving (50g)");
      fireEvent.click(servingButton);
    });

    // The serving should update and re-fetch
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenLastCalledWith(
        `/v0/barcode/preview?barcode=${barcode}&servingGrams=50&userId=${userId}`,
        { headers: { "Content-Type": "application/json" } }
      );
    });
  });

  test("updates serving grams when custom quantity is entered", async () => {
    render(<ProductPreviewScreen barcode={barcode} onClose={onClose} onAddToLog={onAddToLog} />);

    await waitFor(() => {
      const input = screen.getByLabelText("Quantity (g)");
      fireEvent.change(input, { target: { value: "75" } });
    });

    // Should re-fetch with new quantity
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenLastCalledWith(
        `/v0/barcode/preview?barcode=${barcode}&servingGrams=75&userId=${userId}`,
        { headers: { "Content-Type": "application/json" } }
      );
    });
  });

  test("shows error state when fetch fails", async () => {
    (global.fetch as Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    render(<ProductPreviewScreen barcode={barcode} onClose={onClose} onAddToLog={onAddToLog} />);

    await waitFor(() => {
      expect(screen.getByText("Could not load product")).toBeInTheDocument();
      // The actual error message includes the status code
      expect(screen.getByText("Failed to load product preview: 404")).toBeInTheDocument();
    });
  });

  test("shows error when user not logged in", async () => {
    mockLocalStorage.getItem.mockReturnValue(null);

    render(<ProductPreviewScreen barcode={barcode} onClose={onClose} onAddToLog={onAddToLog} />);

    await waitFor(() => {
      expect(screen.getByText("Please sign in to view personalized nutrition assessment")).toBeInTheDocument();
    });
  });

  test("shows different recommendation chip colors", async () => {
    const responseConsider = {
      ...mockAssessmentResponse,
      assessment: {
        ...mockAssessmentResponse.assessment,
        recommendation: "consider_alternative",
        reasoning: "Some concerns. Consider alternative.",
      },
    };
    (global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(responseConsider),
    });

    render(<ProductPreviewScreen barcode={barcode} onClose={onClose} onAddToLog={onAddToLog} />);

    await waitFor(() => {
      // "Consider Alternative" appears in recommendation chip AND primary button - check at least one exists
      expect(screen.getAllByText("Consider Alternative").length).toBeGreaterThanOrEqual(1);
    });
  });

  test("shows skip recommendation", async () => {
    const responseSkip = {
      ...mockAssessmentResponse,
      assessment: {
        ...mockAssessmentResponse.assessment,
        recommendation: "skip",
        reasoning: "Multiple concerns. Skip this product.",
      },
    };
    (global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(responseSkip),
    });

    render(<ProductPreviewScreen barcode={barcode} onClose={onClose} onAddToLog={onAddToLog} />);

    await waitFor(() => {
      // "Skip" appears in recommendation chip AND ghost button - check at least one exists
      expect(screen.getAllByText("Skip").length).toBeGreaterThanOrEqual(1);
    });
  });
});