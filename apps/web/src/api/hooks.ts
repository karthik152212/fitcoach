import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimal async data hook with explicit loading/error states.
 * Every async surface in FitCoach gets a designed state, never a bare "Loading…".
 */

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; error: Error; retry: () => void }
  | { status: "ready"; data: T };

export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const loadRef = useRef(load);
  loadRef.current = load;
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    loadRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            error: error instanceof Error ? error : new Error(String(error)),
            retry: () => setNonce((n) => n + 1),
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return state;
}

/** Imperative mutation helper with pending state. */
export function useMutation<TArgs extends unknown[], TResult>(
  run: (...args: TArgs) => Promise<TResult>,
): {
  execute: (...args: TArgs) => Promise<TResult>;
  pending: boolean;
  error: Error | null;
  reset: () => void;
} {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const execute = useCallback(
    async (...args: TArgs) => {
      setPending(true);
      setError(null);
      try {
        return await run(...args);
      } catch (cause: unknown) {
        const failure = cause instanceof Error ? cause : new Error(String(cause));
        setError(failure);
        throw failure;
      } finally {
        setPending(false);
      }
    },
    [run],
  );
  const reset = useCallback(() => setError(null), []);
  return { execute, pending, error, reset };
}
