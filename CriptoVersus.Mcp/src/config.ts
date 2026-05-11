import { z } from "zod";

import { ConfigurationError } from "./utils/errors.js";

const envSchema = z.object({
  CRIPTO_VERSUS_API_BASE_URL: z.string().url(),
  MCP_SERVER_NAME: z.string().min(1).default("criptoversus-mcp"),
  MCP_SERVER_VERSION: z.string().min(1).default("0.1.0"),
  MCP_AUTH_TOKEN: z.string().default(""),
  PORT: z.coerce.number().int().positive().default(8787),
  NODE_ENV: z.enum(["development", "test", "production"]).default("production")
});

export type AppConfig = {
  apiBaseUrl: string;
  serverName: string;
  serverVersion: string;
  authToken: string;
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

  if (authToken.length === 0 && env.NODE_ENV === "production") {
    throw new ConfigurationError(
      "MCP_AUTH_TOKEN must be configured when NODE_ENV is production."
    );
  }

  return {
    apiBaseUrl: env.CRIPTO_VERSUS_API_BASE_URL.replace(/\/+$/, ""),
    serverName: env.MCP_SERVER_NAME,
    serverVersion: env.MCP_SERVER_VERSION,
    authToken,
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    isOpenMode,
    publicOrigin: new URL(env.CRIPTO_VERSUS_API_BASE_URL).origin,
    requestTimeoutMs: 10_000
  };
}
