/**
 * Authentication middleware for API routes.
 *
 * Extracts and verifies JWT from Authorization header.
 * Attaches authenticated user to request context.
 * All protected routes must use this middleware.
 */

import type { RouteHandler, RouteContext, RouteResult } from "../http";
import { RouteError } from "../http";
import { createAuthService } from "./auth";
import type { PrismaClient } from "@prisma/client";

/** Extended context with authenticated user. */
export interface AuthenticatedContext extends RouteContext {
  /** The authenticated user's ID (from verified JWT). */
  userId: string;
  /** The user's email. */
  userEmail: string;
  /** The raw access token (for downstream Supabase calls). */
  accessToken: string;
}

/**
 * Extract Bearer token from Authorization header.
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/**
 * Authentication middleware.
 * Verifies JWT and attaches user to context.
 * Returns 401 if token is missing, invalid, or expired.
 */
export function authMiddleware(
  handler: (context: AuthenticatedContext) => Promise<RouteResult> | RouteResult,
): RouteHandler {
  return async (context: RouteContext) => {
    const authHeader = context.headers["authorization"] ?? context.headers["Authorization"];
    const token = extractBearerToken(authHeader);

    if (!token) {
      throw new RouteError(401, "unauthorized", "Missing or invalid Authorization header");
    }

    const authService = createAuthService();
    const userId = await authService.verifyToken(token);

    if (!userId) {
      throw new RouteError(401, "unauthorized", "Invalid or expired token");
    }

    // Get user email for context
    const { createServerSupabaseWithAuth } = await import("@fitcoach/supabase");
    const userClient = createServerSupabaseWithAuth(token);
    const { data: { user } } = await userClient.auth.getUser();

    const email = user?.email ?? "";

    // Create authenticated context
    const authContext: AuthenticatedContext = {
      ...context,
      userId,
      userEmail: email,
      accessToken: token,
    };

    return handler(authContext);
  };
}

/**
 * Optional authentication middleware.
 * Attaches user if token is present and valid, but doesn't require it.
 * Use for routes that can work with or without authentication.
 */
export function optionalAuthMiddleware(
  handler: (context: AuthenticatedContext | RouteContext) => Promise<RouteResult> | RouteResult,
): RouteHandler {
  return async (context: RouteContext) => {
    const authHeader = context.headers["authorization"] ?? context.headers["Authorization"];
    const token = extractBearerToken(authHeader);

    if (!token) {
      return handler(context);
    }

    const authService = createAuthService();
    const userId = await authService.verifyToken(token);

    if (!userId) {
      return handler(context);
    }

    const { createServerSupabaseWithAuth } = await import("@fitcoach/supabase");
    const userClient = createServerSupabaseWithAuth(token);
    const { data: { user } } = await userClient.auth.getUser();

    const email = user?.email ?? "";

    const authContext: AuthenticatedContext = {
      ...context,
      userId,
      userEmail: email,
      accessToken: token,
    };

    return handler(authContext);
  };
}

/**
 * Middleware to verify user owns a resource.
 * Use after authMiddleware to ensure userId in params matches authenticated user.
 */
export function ownershipMiddleware(
  paramName: "userId" | "conversationId" | "messageId" = "userId",
): (handler: (context: AuthenticatedContext) => Promise<RouteResult> | RouteResult) => RouteHandler {
  return (handler) => async (context: RouteContext): Promise<RouteResult> => {
    // After authMiddleware, context will have these properties
    const authContext = context as AuthenticatedContext;
    const resourceUserId = authContext.params[paramName];

    if (resourceUserId && resourceUserId !== authContext.userId) {
      throw new RouteError(403, "forbidden", "You can only access your own resources");
    }

    return handler(authContext);
  };
}

/**
 * Combine auth + ownership middleware.
 */
export function authAndOwnership(
  paramName: "userId" | "conversationId" | "messageId" = "userId",
) {
  return (handler: (context: AuthenticatedContext) => Promise<RouteResult> | RouteResult) =>
    authMiddleware(ownershipMiddleware(paramName)(handler));
}

/**
 * Wrapper to execute a callback within a transaction with RLS context set.
 * Uses the authenticated user's ID from the context.
 * Must be used within an authMiddleware-protected handler.
 */
import { withUserTransaction as dbWithUserTransaction, type TransactionClient } from "@fitcoach/db";

export async function withAuthTransaction<T>(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  callback: (tx: TransactionClient) => Promise<T>
): Promise<T> {
  return dbWithUserTransaction(prisma, context.userId, callback);
}

export type { RouteResult } from "../http";