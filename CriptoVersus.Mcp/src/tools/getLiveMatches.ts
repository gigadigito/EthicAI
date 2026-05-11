import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { CriptoVersusClient } from "../http/criptoversusClient.js";
import { formatToolErrorResult, toToolJsonResult } from "../utils/errors.js";

type LiveMatchApiItem = {
  MatchId: number;
  HomeSymbol: string;
  AwaySymbol: string;
  HomeGoals?: number;
  AwayGoals?: number;
  Score?: string;
  Status: string;
  Minute: number;
  PublicUrl: string;
};

export function registerGetLiveMatchesTool(server: McpServer, client: CriptoVersusClient): void {
  server.registerTool(
    "get_live_matches",
    {
      title: "Get Live Matches",
      description: "Returns live public matches from CriptoVersus. Read-only.",
      inputSchema: {
        limit: z.number().int().positive().max(50).default(10)
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true
      }
    },
    async ({ limit = 10 }) => {
      try {
        const payload = await client.getJson<LiveMatchApiItem[]>(
          `/api/matches/live?limit=${limit}`,
          {
            unavailableMessage: "Live matches endpoint is not available yet."
          }
        );

        const matches = payload.map((item) => ({
          matchId: item.MatchId,
          homeSymbol: item.HomeSymbol,
          awaySymbol: item.AwaySymbol,
          score:
            item.Score ??
            `${Math.max(0, item.HomeGoals ?? 0)} x ${Math.max(0, item.AwayGoals ?? 0)}`,
          status: item.Status,
          minute: item.Minute,
          publicUrl: client.toPublicUrl(item.PublicUrl)
        }));

        return toToolJsonResult({ matches });
      } catch (error) {
        return formatToolErrorResult(error);
      }
    }
  );
}
