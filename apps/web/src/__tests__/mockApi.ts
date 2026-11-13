import { vi } from "vitest";

/**
 * FitCoach test API mock.
 *
 * Intercepts global.fetch and returns canned JSON for exact (method, path)
 * routes. Paths are matched on the URL base (query string stripped): a route
 * matches when base === path or base starts with path + "/". The API client
 * sends `fetch(url, { method, ... })`, so the method is read from the second
 * argument.
 *
 * A route may supply `handler(init)` to derive the response body from the
 * request (useful for echoing created resources back).
 */

export const TEST_USER = "00000000-0000-0000-0000-000000000001";

export type MockRoute = {
  method: string;
  path: string;
  status?: number;
  body?: unknown;
  handler?: (init: RequestInit | undefined) => unknown;
};

export function mockApi(routes: readonly MockRoute[]) {
  const byMethod: Record<string, MockRoute[]> = {};
  for (const route of routes) {
    const bucket = byMethod[route.method.toUpperCase()];
    if (bucket) bucket.push(route);
    else byMethod[route.method.toUpperCase()] = [route];
  }

  globalThis.fetch = vi.fn((url: string | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const base = String(url).split("?")[0]!;
    const candidates = byMethod[method] ?? [];
    const match = candidates.find((route) => {
      const rp = route.path.split("?")[0]!;
      return base === rp || base.startsWith(rp.endsWith("/") ? rp : rp + "/");
    });
    if (!match) {
      console.warn(`[mockApi] no route for ${method} ${base}`);
      return Promise.resolve(
        new Response(JSON.stringify({ error: "no_route", message: `no route for ${method} ${base}` }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    const body = match.handler ? match.handler(init) : match.body ?? {};
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: match.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;

  return {
    user: TEST_USER,
    calls: () => (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls,
    lastBody: () => {
      const c = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const last = c[c.length - 1];
      if (!last) return null;
      return JSON.parse(String(last[1]?.body ?? "null"));
    },
  };
}
