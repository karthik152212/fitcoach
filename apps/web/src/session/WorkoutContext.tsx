import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ExerciseSet, SessionClassification, TrainingEnvironmentKind } from "../api/types";

/**
 * Active workout session state.
 *
 * The guide, navigation and overlays must never lose the user's place:
 * this context holds the in-progress workout, the exercise being logged and
 * the sets recorded so far, mirrored to sessionStorage so a guide overlay or
 * a route change returns to the exact previous state.
 *
 * Every mutation is a functional update: starting a session and selecting its
 * first exercise happen in the same tick, and a closure over stale state would
 * silently drop the session that was just created.
 */

export interface ActiveExercise {
  exerciseId: string;
  workoutExerciseId: string;
  name: string;
  /** Hint from the plan/knowledge: whether a load field is meaningful. */
  loadKind: "external_load" | "bodyweight";
  targetSets?: number;
  repMin?: number;
  repMax?: number;
}

export interface ActiveWorkout {
  workoutId: string;
  planId?: string;
  environmentKind?: TrainingEnvironmentKind;
  sessionClassification?: SessionClassification;
  startedAt: string;
  exercise: ActiveExercise | null;
  setsByExercise: Record<string, ExerciseSet[]>;
}

interface WorkoutValue {
  active: ActiveWorkout | null;
  begin: (workout: Omit<ActiveWorkout, "setsByExercise" | "exercise"> & { exercise?: ActiveExercise }) => void;
  selectExercise: (exercise: ActiveExercise) => void;
  recordSet: (exerciseId: string, set: ExerciseSet) => void;
  clear: () => void;
}

const WorkoutContext = createContext<WorkoutValue | null>(null);
const STORAGE_KEY = "fitcoach.activeWorkout";

function readStored(): ActiveWorkout | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ActiveWorkout) : null;
  } catch {
    return null;
  }
}

export function WorkoutProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveWorkout | null>(readStored);

  useEffect(() => {
    try {
      if (active) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(active));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* in-memory only */
    }
  }, [active]);

  const begin = useCallback(
    (workout: Omit<ActiveWorkout, "setsByExercise" | "exercise"> & { exercise?: ActiveExercise }) => {
      setActive({
        ...workout,
        exercise: workout.exercise ?? null,
        setsByExercise: {},
      });
    },
    [],
  );

  const selectExercise = useCallback((exercise: ActiveExercise) => {
    setActive((current) => (current ? { ...current, exercise } : current));
  }, []);

  const recordSet = useCallback((exerciseId: string, set: ExerciseSet) => {
    setActive((current) => {
      if (!current) return current;
      const existing = current.setsByExercise[exerciseId] ?? [];
      return {
        ...current,
        setsByExercise: { ...current.setsByExercise, [exerciseId]: [...existing, set] },
      };
    });
  }, []);

  const clear = useCallback(() => setActive(null), []);

  const value = useMemo(
    () => ({ active, begin, selectExercise, recordSet, clear }),
    [active, begin, selectExercise, recordSet, clear],
  );
  return <WorkoutContext.Provider value={value}>{children}</WorkoutContext.Provider>;
}

export function useWorkout(): WorkoutValue {
  const context = useContext(WorkoutContext);
  if (!context) throw new Error("useWorkout must be used inside <WorkoutProvider>");
  return context;
}
