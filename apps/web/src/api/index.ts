import { useCallback } from "react";
import { useSession } from "../session/SessionContext";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";

export class ApiResult<T = any> implements PromiseLike<T> {
  private promise: Promise<T>;

  constructor(promise: Promise<Response>) {
    this.promise = promise.then(async (response) => {
      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const data = await response.json();
          message = data.message ?? message;
        } catch {
          /* ignore */
        }
        throw new Error(message);
      }
      return response.json() as T;
    });
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.promise.then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<T | TResult> {
    return this.promise.catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.promise.finally(onfinally);
  }

  json(): Promise<T> {
    return this.promise;
  }

  text(): Promise<string> {
    // Need to refetch for text, but we can't easily. Return a promise that gets text from the original response
    return this.promise.then(() => Promise.reject(new Error("text() not supported on this result type")));
  }

  blob(): Promise<Blob> {
    return this.promise.then(() => Promise.reject(new Error("blob() not supported on this result type")));
  }

  [Symbol.toStringTag]: string = "ApiResult";
}

function getHeaders(userId: string | null): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (userId) {
    headers["X-User-Id"] = userId;
  }
  return headers;
}

export function useApi() {
  const { userId } = useSession();

  const request = useCallback(
    (path: string, options: RequestInit = {}): ApiResult => {
      const responsePromise = fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          ...getHeaders(userId),
          ...options.headers,
        },
      });
      return new ApiResult(responsePromise);
    },
    [userId]
  );

  return {
    get: (path: string, init?: RequestInit) => request(path, { method: "GET", ...init }),
    post: (path: string, body: unknown, init?: RequestInit) =>
      request(path, { method: "POST", body: JSON.stringify(body), ...init }),
    put: (path: string, body: unknown, init?: RequestInit) =>
      request(path, { method: "PUT", body: JSON.stringify(body), ...init }),
    patch: (path: string, body: unknown, init?: RequestInit) =>
      request(path, { method: "PATCH", body: JSON.stringify(body), ...init }),
    delete: (path: string, init?: RequestInit) => request(path, { method: "DELETE", ...init }),
  };
}

// Re-export endpoints for convenience
export * from "./endpoints";

// For backward compatibility - a non-hook version that reads from localStorage
export const api = {
  get<T = any>(path: string, init?: RequestInit): ApiResult<T> {
    const userId = typeof window !== "undefined" ? localStorage.getItem("fitcoach.userId") : null;
    const responsePromise = fetch(`${API_BASE}${path}`, { method: "GET", headers: getHeaders(userId), ...init });
    return new ApiResult<T>(responsePromise);
  },

  post<T = any>(path: string, body: unknown, init?: RequestInit): ApiResult<T> {
    const userId = typeof window !== "undefined" ? localStorage.getItem("fitcoach.userId") : null;
    const responsePromise = fetch(`${API_BASE}${path}`, { method: "POST", headers: getHeaders(userId), body: JSON.stringify(body), ...init });
    return new ApiResult<T>(responsePromise);
  },

  put<T = any>(path: string, body: unknown, init?: RequestInit): ApiResult<T> {
    const userId = typeof window !== "undefined" ? localStorage.getItem("fitcoach.userId") : null;
    const responsePromise = fetch(`${API_BASE}${path}`, { method: "PUT", headers: getHeaders(userId), body: JSON.stringify(body), ...init });
    return new ApiResult<T>(responsePromise);
  },

  patch<T = any>(path: string, body: unknown, init?: RequestInit): ApiResult<T> {
    const userId = typeof window !== "undefined" ? localStorage.getItem("fitcoach.userId") : null;
    const responsePromise = fetch(`${API_BASE}${path}`, { method: "PATCH", headers: getHeaders(userId), body: JSON.stringify(body), ...init });
    return new ApiResult<T>(responsePromise);
  },

  delete<T = any>(path: string, init?: RequestInit): ApiResult<T> {
    const userId = typeof window !== "undefined" ? localStorage.getItem("fitcoach.userId") : null;
    const responsePromise = fetch(`${API_BASE}${path}`, { method: "DELETE", headers: getHeaders(userId), ...init });
    return new ApiResult<T>(responsePromise);
  },
};