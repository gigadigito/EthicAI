import type { Express, Request, Response } from "express";
import { z } from "zod";

import {
  assertTokenRevoked,
  createSessionAuthMiddleware,
  generateMcpToken,
  hashToken,
  parseTokenId,
  requireWalletAddress,
  sanitizeTokenName
} from "../auth/tokenAuth.js";
import type { AppConfig } from "../config.js";
import type { DatabaseStore } from "../db/database.js";

const tokenCreateSchema = z.object({
  name: z.string().max(200).optional()
});

export function registerTokenRoutes(
  app: Express,
  dependencies: {
    config: AppConfig;
    store: DatabaseStore;
  }
): void {
  const { config, store } = dependencies;
  const requireSession = createSessionAuthMiddleware(store);

  app.get("/tokens", requireSession, (_req: Request, res: Response, next) => {
    try {
      const walletAddress = requireWalletAddress(res);
      const items = store.listTokensByWallet(walletAddress).map((item) => ({
        id: item.id,
        name: item.name,
        createdAt: item.created_at,
        lastUsedAt: item.last_used_at,
        revokedAt: item.revoked_at,
        dailyLimit: item.daily_limit
      }));

      res.json({
        walletAddress,
        tokens: items
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/tokens", requireSession, (req: Request, res: Response, next) => {
    try {
      const payload = tokenCreateSchema.parse(req.body);
      const walletAddress = requireWalletAddress(res);
      const name = sanitizeTokenName(payload.name);
      const createdAt = new Date().toISOString();
      const token = generateMcpToken(config.tokenPrefix);

      store.createMcpToken({
        walletAddress,
        name,
        tokenHash: hashToken(token),
        tokenPrefix: config.tokenPrefix,
        createdAt,
        dailyLimit: config.tokenDefaultDailyLimit
      });

      res.status(201).json({
        token,
        name,
        createdAt,
        dailyLimit: config.tokenDefaultDailyLimit
      });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/tokens/:id", requireSession, (req: Request, res: Response, next) => {
    try {
      const walletAddress = requireWalletAddress(res);
      const tokenId = parseTokenId(String(req.params.id));
      const revoked = store.revokeToken(tokenId, walletAddress, new Date().toISOString());

      assertTokenRevoked(revoked);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });
}
