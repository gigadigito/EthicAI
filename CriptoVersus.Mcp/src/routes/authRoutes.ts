import type { Express, Request, Response } from "express";
import { z } from "zod";

import { generateSessionToken, hashToken } from "../auth/tokenAuth.js";
import {
  SESSION_TTL_MS,
  createWalletChallenge,
  normalizeWalletAddress,
  verifyWalletSignature
} from "../auth/walletAuth.js";
import type { AppConfig } from "../config.js";
import type { DatabaseStore } from "../db/database.js";
import { UnauthorizedError } from "../utils/errors.js";

const challengeSchema = z.object({
  walletAddress: z.string().min(32).max(64)
});

const verifySchema = z.object({
  walletAddress: z.string().min(32).max(64),
  message: z.string().min(1).max(4096),
  signature: z.string().min(1).max(512)
});

export function registerAuthRoutes(
  app: Express,
  dependencies: {
    config: AppConfig;
    store: DatabaseStore;
  }
): void {
  const { config, store } = dependencies;

  app.post("/auth/challenge", (req: Request, res: Response, next) => {
    try {
      const payload = challengeSchema.parse(req.body);
      const walletAddress = normalizeWalletAddress(payload.walletAddress);
      const challenge = createWalletChallenge(config, walletAddress);

      store.purgeExpiredRecords(new Date().toISOString());
      store.createChallenge({
        walletAddress,
        nonce: challenge.nonce,
        message: challenge.message,
        createdAt: challenge.createdAt,
        expiresAt: challenge.expiresAt
      });

      res.json({
        message: challenge.message,
        nonce: challenge.nonce,
        expiresAt: challenge.expiresAt
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/auth/verify", (req: Request, res: Response, next) => {
    try {
      const payload = verifySchema.parse(req.body);
      const walletAddress = normalizeWalletAddress(payload.walletAddress);
      const nowIso = new Date().toISOString();
      const challenge = store.findValidChallenge(walletAddress, payload.message, nowIso);

      if (!challenge) {
        throw new UnauthorizedError("Challenge is invalid, used, or expired.");
      }

      verifyWalletSignature({
        walletAddress,
        message: payload.message,
        signature: payload.signature
      });

      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      const sessionToken = generateSessionToken();

      store.markChallengeUsed(challenge.id, createdAt);
      store.createSession({
        walletAddress,
        sessionTokenHash: hashToken(sessionToken),
        createdAt,
        expiresAt
      });

      res.json({
        sessionToken
      });
    } catch (error) {
      next(error);
    }
  });
}
