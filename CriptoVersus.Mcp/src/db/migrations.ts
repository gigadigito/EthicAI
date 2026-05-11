export const migrationStatements = [
  `
    CREATE TABLE IF NOT EXISTS wallet_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_address TEXT NOT NULL,
      session_token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS auth_challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_address TEXT NOT NULL,
      nonce TEXT NOT NULL,
      message TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT NULL,
      created_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS mcp_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_address TEXT NOT NULL,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT NULL,
      revoked_at TEXT NULL,
      daily_limit INTEGER NOT NULL
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_wallet_sessions_hash
    ON wallet_sessions(session_token_hash)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_wallet_sessions_wallet
    ON wallet_sessions(wallet_address)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_auth_challenges_wallet
    ON auth_challenges(wallet_address, created_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_mcp_tokens_hash
    ON mcp_tokens(token_hash)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_mcp_tokens_wallet
    ON mcp_tokens(wallet_address, created_at DESC)
  `
] as const;
