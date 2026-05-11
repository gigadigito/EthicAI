import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { CriptoVersusClient } from "../http/criptoversusClient.js";
import { formatToolErrorResult, toToolJsonResult } from "../utils/errors.js";

type SocialHotMatchApiItem = {
  MatchId: number;
  HomeSymbol: string;
  AwaySymbol: string;
  HomeGoals: number;
  AwayGoals: number;
  Status: string;
  Minute: number;
  HotScore: number;
  Reason: string;
  PublicUrl: string;
};

export function registerGetHotMatchesTool(server: McpServer, client: CriptoVersusClient): void {
  server.registerTool(
    "get_hot_matches",
    {
      title: "Get Hot Matches",
      description:
        "Returns public hot matches from CriptoVersus for narrative analysis. Read-only.",
      inputSchema: {
        limit: z.number().int().positive().max(50).default(5),
        minHotScore: z.number().min(0).max(100).default(50)
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true
      }
    },
    async ({ limit = 5, minHotScore = 50 }) => {
      try {
        const payload = await client.getJson<SocialHotMatchApiItem[]>("/api/social/hot-matches");
        const matches = payload
          .filter((item) => item.HotScore >= minHotScore)
          .slice(0, limit)
          .map((item) => ({
            matchId: item.MatchId,
            homeSymbol: item.HomeSymbol,
            awaySymbol: item.AwaySymbol,
            score: `${item.HomeGoals} x ${item.AwayGoals}`,
            status: item.Status,
            minute: item.Minute,
            hotScore: item.HotScore,
            reason: item.Reason,
            publicUrl: client.toPublicUrl(item.PublicUrl)
          }));

        return toToolJsonResult({ matches });
      } catch (error) {
        return formatToolErrorResult(error);
      }
    }
  );
}
