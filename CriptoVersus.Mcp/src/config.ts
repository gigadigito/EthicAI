import { z } from "zod";

import { ConfigurationError } from "./utils/errors.js";

const envSchema = z.object({
  CRIPTO_VERSUS_API_BASE_URL: z.string().url(),
  MCP_SERVER_NAME: z.string().min(1).default("criptoversus-mcp"),
  MCP_SERVER_VERSION: z.string().min(1).default("0.1.0"),
  MCP_AUTH_TOKEN: z.string().default(""),
  MCP_TOKEN_DB_PATH: z.string().min(1).default("/data/criptoversus-mcp.sqlite"),
  MCP_PUBLIC_BASE_URL: z.string().url().default("https://mcp.criptoversus.com"),
  MCP_TOKEN_PREFIX: z.string().min(1).default("cv_mcp_"),
  MCP_TOKEN_DEFAULT_DAILY_LIMIT: z.coerce.number().int().positive().default(1000),
  PORT: z.coerce.number().int().positive().default(8787),
  NODE_ENV: z.enum(["development", "test", "production"]).default("production")
});

export type AppConfig = {
  apiBaseUrl: string;
  serverName: string;
  serverVersion: string;
  authToken: string;
  tokenDbPath: string;
  publicBaseUrl: string;
  tokenPrefix: string;
  tokenDefaultDailyLimit: number;
  port: number;
  nodeEnv: "development" | "test" | "production";
  isOpenMode: boolean;
  publicOrigin: string;
  requestTimeoutMs: number;
};

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new ConfigurationError("Invalid environment configuration.");
  }

  const env = parsed.data;
  const authToken = env.MCP_AUTH_TOKEN.trim();
  const isOpenMode = authToken.length === 0 && env.NODE_ENV !== "production";

  return {
    apiBaseUrl: env.CRIPTO_VERSUS_API_BASE_URL.replace(/\/+$/, ""),
    serverName: env.MCP_SERVER_NAME,
    serverVersion: env.MCP_SERVER_VERSION,
    authToken,
    tokenDbPath: env.MCP_TOKEN_DB_PATH,
    publicBaseUrl: env.MCP_PUBLIC_BASE_URL.replace(/\/+$/, ""),
    tokenPrefix: env.MCP_TOKEN_PREFIX,
    tokenDefaultDailyLimit: env.MCP_TOKEN_DEFAULT_DAILY_LIMIT,
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    isOpenMode,
    publicOrigin: new URL(env.CRIPTO_VERSUS_API_BASE_URL).origin,
    requestTimeoutMs: 10_000
  };
}
