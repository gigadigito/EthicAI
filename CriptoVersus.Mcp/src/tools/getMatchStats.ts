import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { CriptoVersusClient } from "../http/criptoversusClient.js";
import { formatToolErrorResult, toToolJsonResult } from "../utils/errors.js";

export function registerGetMatchStatsTool(server: McpServer, client: CriptoVersusClient): void {
  server.registerTool(
    "get_match_stats",
    {
      title: "Get Match Stats",
      description: "Returns public match statistics for a CriptoVersus match. Read-only.",
      inputSchema: {
        matchId: z.number().int().positive()
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true
      }
    },
    async ({ matchId }) => {
      try {
        const stats = await client.getJson<Record<string, unknown>>(
          `/api/matches/${matchId}/stats`,
          {
            unavailableMessage: "Match stats endpoint is not available yet."
          }
        );

        return toToolJsonResult(stats);
      } catch (error) {
        return formatToolErrorResult(error);
      }
    }
  );
}
