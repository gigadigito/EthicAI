import express, { type NextFunction, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createMcpAuthMiddleware } from "./auth/tokenAuth.js";
import { loadConfig } from "./config.js";
import { DatabaseStore } from "./db/database.js";
import { CriptoVersusClient } from "./http/criptoversusClient.js";
import { registerAuthRoutes } from "./routes/authRoutes.js";
import { registerTokenRoutes } from "./routes/tokenRoutes.js";
import { registerWebRoutes } from "./routes/webRoutes.js";
import { registerGetHotMatchesTool } from "./tools/getHotMatches.js";
import { registerGetLiveMatchesTool } from "./tools/getLiveMatches.js";
import { registerGetMatchStatsTool } from "./tools/getMatchStats.js";
import { registerGetRankingsTool } from "./tools/getRankings.js";
import {
  getPublicErrorMessage,
  getStatusCode
} from "./utils/errors.js";

const config = loadConfig();
const store = new DatabaseStore(config);
const app = express();

app.disable("x-powered-by");
app.use(
  express.json({
    limit: "1mb"
  })
);

registerWebRoutes(app);

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    name: config.serverName,
    version: config.serverVersion
  });
});

registerAuthRoutes(app, { config, store });
registerTokenRoutes(app, { config, store });

app.post("/mcp", createMcpAuthMiddleware(config, store), async (req, res, next) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  try {
    const server = createServer();
    await server.connect(transport);
    res.on("close", () => {
      void transport.close();
    });

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: `Route ${req.method} ${req.path} was not found.`
  });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const statusCode = getStatusCode(error);
  const message = getPublicErrorMessage(error);

  if (!res.headersSent) {
    res.status(statusCode).json({
      error: message
    });
  }
});

app.listen(config.port, () => {
  const authMode = config.isOpenMode ? "open-development" : "bearer-token";
  console.log(
    `[${config.serverName}] listening on port ${config.port} in ${config.nodeEnv} mode (${authMode}).`
  );
});

function createServer(): McpServer {
  const server = new McpServer(
    {
      name: config.serverName,
      version: config.serverVersion
    },
    {
      instructions:
        "CriptoVersus MCP is a read-only server for public arena, match and social data. Never use it for financial operations, private keys, custody, ledger access, or direct database queries."
    }
  );

  const client = new CriptoVersusClient(config);

  registerGetLiveMatchesTool(server, client);
  registerGetHotMatchesTool(server, client);
  registerGetMatchStatsTool(server, client);
  registerGetRankingsTool(server, client);

  return server;
}
