import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { CriptoVersusClient } from "../http/criptoversusClient.js";
import { formatToolErrorResult, toToolJsonResult } from "../utils/errors.js";

export function registerGetRankingsTool(server: McpServer, client: CriptoVersusClient): void {
  server.registerTool(
    "get_rankings",
    {
      title: "Get Rankings",
      description: "Returns public CriptoVersus rankings for teams, assets, or agents. Read-only.",
      inputSchema: {
        type: z.enum(["teams", "assets", "agents"]).default("assets"),
        limit: z.number().int().positive().max(100).default(20)
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true
      }
    },
    async ({ type = "assets", limit = 20 }) => {
      try {
        const rankings = await client.getJson<Record<string, unknown>>(
          `/api/rankings?type=${encodeURIComponent(type)}&limit=${limit}`,
          {
            unavailableMessage: "Ranking endpoint is not available yet."
          }
        );

        return toToolJsonResult(rankings);
      } catch (error) {
        return formatToolErrorResult(error);
      }
    }
  );
}
