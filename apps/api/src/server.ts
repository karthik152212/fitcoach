import * as http from "node:http";
import { Router } from "./http";
import { registerExampleRoutes, registerRoutes } from "./routes";
import type { AppServices } from "./services";

// Continuity: existing tests and docs import these from ./server.
export { buildExampleUser, createUserSummary } from "./example";

export interface ServerOptions {
  /**
   * Application services (built over repositories). When omitted — e.g. the
   * placeholder smoke tests — only the example/health routes are registered
   * and database-backed routes return 404 rather than crashing.
   */
  services?: AppServices;
}

/**
 * Build the HTTP server. Thin shell: parse → validate → service → respond.
 */
export function createServer(options: ServerOptions = {}): http.Server {
  const router = new Router();
  registerExampleRoutes(router);
  if (options.services) {
    registerRoutes(router, options.services);
  }
  return http.createServer((request, response) => {
    void router.handle(request, response);
  });
}
