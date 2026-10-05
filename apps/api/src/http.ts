import * as http from "node:http";
import { RepositoryError } from "@fitcoach/db";
import { RequestValidationError } from "./validation";

/**
 * Minimal router for apps/api (no framework — milestone §18). Patterns are
 * literal segments plus `:param` captures. JSON bodies are parsed with a
 * size limit; errors render as a stable envelope:
 *
 *   { "error": "<code>", "message": "...", "path": "<field>"? }
 */

export const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;
const MAX_BODY_BYTES = 1_000_000;

export class RouteError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.name = "RouteError";
    this.status = status;
    this.code = code;
  }
}

export interface RouteContext {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
}

export interface RouteResult {
  status?: number;
  body: unknown;
}

export type RouteHandler = (context: RouteContext) => Promise<RouteResult> | RouteResult;

interface Route {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

export function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, JSON_HEADERS);
  response.end(JSON.stringify(body));
}

/**
 * Render any thrown value as a safe HTTP error. Repository failures are
 * already sanitized (no SQL, no parameters); unknown failures render as a
 * generic internal error so implementation details never reach clients.
 */
export function sendError(response: http.ServerResponse, error: unknown): void {
  if (error instanceof RequestValidationError) {
    sendJson(response, 400, {
      error: "validation_failed",
      message: error.message,
      path: error.path,
    });
    return;
  }
  if (error instanceof RouteError) {
    sendJson(response, error.status, { error: error.code, message: error.message });
    return;
  }
  if (error instanceof RepositoryError) {
    switch (error.kind) {
      case "not_found":
        sendJson(response, 404, { error: "not_found", message: error.message });
        return;
      case "conflict":
        sendJson(response, 409, { error: "conflict", message: error.message });
        return;
      case "validation":
        sendJson(response, 400, { error: "validation_failed", message: error.message });
        return;
      case "immutable":
        sendJson(response, 409, { error: "immutable_record", message: error.message });
        return;
      default:
        break;
    }
  }
  // Unknown failure: log the class only (messages can carry request context).
  const name = error instanceof Error ? error.name : typeof error;
  process.stderr.write(`[api] unhandled error: ${name}\n`);
  sendJson(response, 500, { error: "internal_error", message: "internal server error" });
}

function splitPath(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

function readBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new RouteError(413, "payload_too_large", "request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.trim().length === 0) {
        resolve({});
        return;
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          reject(new RequestValidationError("body", "must be a JSON object"));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new RequestValidationError("body", "must be valid JSON"));
      }
    });
  });
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: RouteHandler): this {
    this.routes.push({ method: method.toUpperCase(), segments: splitPath(pattern), handler });
    return this;
  }

  private match(
    method: string,
    segments: string[],
  ): { route: Route; params: Record<string, string> } | "method_not_allowed" | null {
    let pathFound = false;
    for (const route of this.routes) {
      if (route.segments.length !== segments.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const pattern = route.segments[i]!;
        const actual = segments[i]!;
        if (pattern.startsWith(":")) {
          params[pattern.slice(1)] = decodeURIComponent(actual);
        } else if (pattern !== actual) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      pathFound = true;
      if (route.method === method) return { route, params };
    }
    return pathFound ? "method_not_allowed" : null;
  }

  async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const method = (request.method ?? "GET").toUpperCase();
    const url = new URL(request.url ?? "/", "http://localhost");
    const segments = splitPath(url.pathname);

    try {
      const matched = this.match(method, segments);
      if (matched === null) {
        sendJson(response, 404, { error: "not_found", message: "route not found" });
        return;
      }
      if (matched === "method_not_allowed") {
        sendJson(response, 405, { error: "method_not_allowed", message: "method not allowed" });
        return;
      }

      let body: Record<string, unknown> = {};
      if (method !== "GET" && method !== "HEAD" && method !== "DELETE") {
        body = await readBody(request);
      }

      const result = await matched.route.handler({
        method,
        path: url.pathname,
        params: matched.params,
        query: url.searchParams,
        body,
      });
      sendJson(response, result.status ?? 200, result.body);
    } catch (error) {
      sendError(response, error);
    }
  }
}
