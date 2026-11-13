import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "./shell/AppShell";
import { HomeScreen } from "./screens/HomeScreen";
import { OnboardingScreen } from "./screens/OnboardingScreen";
import { PlanScreen } from "./screens/PlanScreen";
import { TrainScreen } from "./screens/TrainScreen";
import { ExerciseScreen } from "./screens/ExerciseScreen";
import { PerformScreen } from "./screens/PerformScreen";
import { ReviewScreen } from "./screens/ReviewScreen";
import { ProgressScreen } from "./screens/ProgressScreen";
import { YouScreen } from "./screens/YouScreen";
import { NutritionScreen } from "./screens/NutritionScreen";
import { MealLoggingScreen } from "./screens/MealLoggingScreen";
import { FoodDetailScreen } from "./screens/FoodDetailScreen";
import { RecipeScreen } from "./screens/RecipeScreen";
import { NutritionTargetsScreen } from "./screens/NutritionTargetsScreen";
import { NutritionTrendsScreen } from "./screens/NutritionTrendsScreen";
import { ActivityScreen } from "./screens/ActivityScreen";
import { RecoveryScreen } from "./screens/RecoveryScreen";
import { SleepScreen } from "./screens/SleepScreen";
import { CoachScreen } from "./screens/CoachScreen";
import { SignInScreen, SignUpScreen } from "./screens/AuthScreen";
import { WorkoutProvider } from "./session/WorkoutContext";
import { SessionProvider } from "./session/SessionContext";

export const router = createBrowserRouter([
  // Public auth routes (no shell)
  {
    element: <SessionProvider />,
    children: [
      { path: "/signin", element: <SignInScreen /> },
      { path: "/signup", element: <SignUpScreen /> },
    ],
  },
  // Protected app routes (with shell)
  {
    element: (
      <SessionProvider>
        <WorkoutProvider>
          <AppShell />
        </WorkoutProvider>
      </SessionProvider>
    ),
    children: [
      { path: "/", element: <HomeScreen /> },
      { path: "/onboarding", element: <OnboardingScreen /> },
      { path: "/plan", element: <PlanScreen /> },
      { path: "/train", element: <TrainScreen /> },
      { path: "/exercise/:exerciseId", element: <ExerciseScreen /> },
      { path: "/exercise/:exerciseId/perform", element: <PerformScreen /> },
      { path: "/review/:workoutId", element: <ReviewScreen /> },
      { path: "/progress", element: <ProgressScreen /> },
      { path: "/you", element: <YouScreen /> },
      { path: "/nutrition", element: <NutritionScreen /> },
      { path: "/nutrition/meals/new", element: <MealLoggingScreen /> },
      { path: "/nutrition/meals/:mealId/edit", element: <MealLoggingScreen /> },
      { path: "/nutrition/foods/:foodId", element: <FoodDetailScreen /> },
      { path: "/nutrition/recipes", element: <RecipeScreen /> },
      { path: "/nutrition/targets", element: <NutritionTargetsScreen /> },
      { path: "/nutrition/trends", element: <NutritionTrendsScreen /> },
      { path: "/activity", element: <ActivityScreen /> },
      { path: "/recovery", element: <RecoveryScreen /> },
      { path: "/sleep", element: <SleepScreen /> },
      { path: "/coach", element: <CoachScreen /> },
      { path: "/coach/:conversationId", element: <CoachScreen /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
