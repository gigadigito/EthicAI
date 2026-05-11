import fs from "node:fs";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";

import type { AppConfig } from "../config.js";
import { migrationStatements } from "./migrations.js";

export type WalletSessionRecord = {
  id: number;
  wallet_address: string;
  session_token_hash: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
};

export type AuthChallengeRecord = {
  id: number;
  wallet_address: string;
  nonce: string;
  message: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

export type McpTokenRecord = {
  id: number;
  wallet_address: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  daily_limit: number;
};

export class DatabaseStore {
  private readonly db: BetterSqlite3.Database;

  constructor(config: AppConfig) {
    const dbPath = path.resolve(config.tokenDbPath);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    cleanupSqliteSidecars(dbPath);

    this.db = new BetterSqlite3(dbPath);

    for (const statement of migrationStatements) {
      this.db.exec(statement);
    }
  }

  createChallenge(input: {
    walletAddress: string;
    nonce: string;
    message: string;
    createdAt: string;
    expiresAt: string;
  }): void {
    this.db
      .prepare(
        `
          INSERT INTO auth_challenges (
            wallet_address,
            nonce,
            message,
            expires_at,
            used_at,
            created_at
          ) VALUES (?, ?, ?, ?, NULL, ?)
        `
      )
      .run(input.walletAddress, input.nonce, input.message, input.expiresAt, input.createdAt);
  }

  findValidChallenge(walletAddress: string, message: string, nowIso: string): AuthChallengeRecord | null {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM auth_challenges
          WHERE wallet_address = ?
            AND message = ?
            AND used_at IS NULL
            AND expires_at > ?
          ORDER BY created_at DESC
          LIMIT 1
        `
      )
      .get(walletAddress, message, nowIso);

    return (row as AuthChallengeRecord | undefined) ?? null;
  }

  markChallengeUsed(id: number, usedAt: string): void {
    this.db.prepare("UPDATE auth_challenges SET used_at = ? WHERE id = ?").run(usedAt, id);
  }

  createSession(input: {
    walletAddress: string;
    sessionTokenHash: string;
    createdAt: string;
    expiresAt: string;
  }): void {
    this.db
      .prepare(
        `
          INSERT INTO wallet_sessions (
            wallet_address,
            session_token_hash,
            created_at,
            expires_at,
            revoked_at
          ) VALUES (?, ?, ?, ?, NULL)
        `
      )
      .run(input.walletAddress, input.sessionTokenHash, input.createdAt, input.expiresAt);
  }

  findValidSession(sessionTokenHash: string, nowIso: string): WalletSessionRecord | null {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM wallet_sessions
          WHERE session_token_hash = ?
            AND revoked_at IS NULL
            AND expires_at > ?
          LIMIT 1
        `
      )
      .get(sessionTokenHash, nowIso);

    return (row as WalletSessionRecord | undefined) ?? null;
  }

  createMcpToken(input: {
    walletAddress: string;
    name: string;
    tokenHash: string;
    tokenPrefix: string;
    createdAt: string;
    dailyLimit: number;
  }): number {
    const result = this.db
      .prepare(
        `
          INSERT INTO mcp_tokens (
            wallet_address,
            name,
            token_hash,
            token_prefix,
            created_at,
            last_used_at,
            revoked_at,
            daily_limit
          ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
        `
      )
      .run(
        input.walletAddress,
        input.name,
        input.tokenHash,
        input.tokenPrefix,
        input.createdAt,
        input.dailyLimit
      );

    return Number(result.lastInsertRowid);
  }

  listTokensByWallet(walletAddress: string): McpTokenRecord[] {
    const rows = this.db
      .prepare(
        `
          SELECT id, wallet_address, name, token_hash, token_prefix, created_at, last_used_at, revoked_at, daily_limit
          FROM mcp_tokens
          WHERE wallet_address = ?
          ORDER BY created_at DESC
        `
      )
      .all(walletAddress);

    return rows as McpTokenRecord[];
  }

  revokeToken(id: number, walletAddress: string, revokedAt: string): boolean {
    const result = this.db
      .prepare(
        `
          UPDATE mcp_tokens
          SET revoked_at = COALESCE(revoked_at, ?)
          WHERE id = ?
            AND wallet_address = ?
        `
      )
      .run(revokedAt, id, walletAddress);

    return result.changes > 0;
  }

  findValidMcpToken(tokenHash: string): McpTokenRecord | null {
    const row = this.db
      .prepare(
        `
          SELECT id, wallet_address, name, token_hash, token_prefix, created_at, last_used_at, revoked_at, daily_limit
          FROM mcp_tokens
          WHERE token_hash = ?
            AND revoked_at IS NULL
          LIMIT 1
        `
      )
      .get(tokenHash);

    return (row as McpTokenRecord | undefined) ?? null;
  }

  touchMcpToken(id: number, lastUsedAt: string): void {
    this.db.prepare("UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?").run(lastUsedAt, id);
  }

  purgeExpiredRecords(nowIso: string): void {
    this.db.prepare("DELETE FROM auth_challenges WHERE expires_at <= ? OR used_at IS NOT NULL").run(nowIso);
    this.db.prepare("DELETE FROM wallet_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL").run(nowIso);
  }
}

function cleanupSqliteSidecars(dbPath: string): void {
  for (const suffix of ["-journal", "-wal", "-shm"]) {
    const sidecarPath = `${dbPath}${suffix}`;

    try {
      if (fs.existsSync(sidecarPath)) {
        fs.rmSync(sidecarPath, { force: true });
      }
    } catch {
      // Ignore stale sidecar cleanup failures and let SQLite attempt normal recovery.
    }
  }
}
