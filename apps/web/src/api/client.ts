import type { ApiError } from "./types";
import { getBrowserSession } from "@fitcoach/supabase";

/**
 * Thin typed fetch client for the FitCoach /v0 API.
 * No business logic lives here — request structured data, render it.
 */

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

let authTokenGetter: (() => Promise<string | null>) | null = null;

export function setAuthTokenGetter(getter: () => Promise<string | null>): void {
  authTokenGetter = getter;
}

async function getAuthToken(): Promise<string | null> {
  if (authTokenGetter) {
    return authTokenGetter();
  }
  try {
    const existingSession = await getBrowserSession();
    return existingSession?.accessToken ?? null;
  } catch {
    return null;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (token) {
      headers["authorization"] = `Bearer ${token}`;
    }
    response = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiRequestError(0, "unavailable", "FitCoach is unreachable. Check your connection and retry.");
  }

  const raw = await response.text();
  const data = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {};
  if (!response.ok) {
    const error = data as unknown as ApiError;
    throw new ApiRequestError(
      response.status,
      error.error ?? "error",
      // Safe server messages only; never echo submitted values back.
      error.message ?? "Something went wrong. Retry in a moment.",
      error.path,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>("GET", path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown): Promise<T> => request<T>("PUT", path, body),
};

export function newClientRequestId(): string {
  return crypto.randomUUID();
}