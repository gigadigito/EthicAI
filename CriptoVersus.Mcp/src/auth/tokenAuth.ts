import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

import type { AppConfig } from "../config.js";
import type { DatabaseStore } from "../db/database.js";
import {
  ConfigurationError,
  NotFoundError,
  UnauthorizedError,
  ValidationError
} from "../utils/errors.js";

type AuthenticatedLocals = {
  walletAddress?: string;
  sessionTokenHash?: string;
  authKind?: "session" | "mcp-admin" | "mcp-wallet" | "mcp-open";
};

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken(): string {
  return `cv_session_${crypto.randomBytes(24).toString("hex")}`;
}

export function generateMcpToken(prefix: string): string {
  return `${prefix}${crypto.randomBytes(24).toString("hex")}`;
}

export function extractBearerToken(authHeader: string | undefined): string {
  if (!authHeader) {
    throw new UnauthorizedError("Missing bearer token.");
  }

  const [scheme, token] = authHeader.split(" ", 2);
  if (scheme !== "Bearer" || !token?.trim()) {
    throw new UnauthorizedError("Missing bearer token.");
  }

  return token.trim();
}

export function sanitizeTokenName(name: string | undefined): string {
  const sanitized = (name ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  return sanitized || "MCP Token";
}

export function createSessionAuthMiddleware(store: DatabaseStore) {
  return (req: Request, res: Response<unknown, AuthenticatedLocals>, next: NextFunction): void => {
    try {
      const token = extractBearerToken(req.header("authorization"));
      const nowIso = new Date().toISOString();
      const session = store.findValidSession(hashToken(token), nowIso);

      if (!session) {
        throw new UnauthorizedError("Session token is missing, expired, or invalid.");
      }

      res.locals.walletAddress = session.wallet_address;
      res.locals.sessionTokenHash = session.session_token_hash;
      res.locals.authKind = "session";
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createMcpAuthMiddleware(config: AppConfig, store: DatabaseStore) {
  return (req: Request, res: Response<unknown, AuthenticatedLocals>, next: NextFunction): void => {
    try {
      const authHeader = req.header("authorization");

      if (config.isOpenMode && !authHeader) {
        res.locals.authKind = "mcp-open";
        next();
        return;
      }

      const token = extractBearerToken(authHeader);

      if (config.authToken && token === config.authToken) {
        res.locals.authKind = "mcp-admin";
        next();
        return;
      }

      const record = store.findValidMcpToken(hashToken(token));
      if (!record) {
        throw new UnauthorizedError("Missing or invalid bearer token.");
      }

      store.touchMcpToken(record.id, new Date().toISOString());
      res.locals.walletAddress = record.wallet_address;
      res.locals.authKind = "mcp-wallet";
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireWalletAddress(res: Response<unknown, AuthenticatedLocals>): string {
  if (!res.locals.walletAddress) {
    throw new ConfigurationError("Authenticated wallet context is unavailable.");
  }

  return res.locals.walletAddress;
}

export function parseTokenId(rawId: string): number {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError("Token id must be a positive integer.");
  }

  return id;
}

export function assertTokenRevoked(result: boolean): void {
  if (!result) {
    throw new NotFoundError("Token was not found for this wallet.");
  }
}
