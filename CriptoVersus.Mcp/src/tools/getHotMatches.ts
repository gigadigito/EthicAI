import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { CriptoVersusClient } from "../http/criptoversusClient.js";
import { formatToolErrorResult, toToolJsonResult } from "../utils/errors.js";

type SocialHotMatchApiItem = {
  MatchId?: number;
  matchId?: number;
  HomeSymbol?: string;
  homeSymbol?: string;
  AwaySymbol?: string;
  awaySymbol?: string;
  HomeGoals?: number;
  homeGoals?: number;
  AwayGoals?: number;
  awayGoals?: number;
  Status?: string;
  status?: string;
  Minute?: number;
  minute?: number;
  HotScore?: number;
  hotScore?: number;
  Reason?: string;
  reason?: string;
  PublicUrl?: string;
  publicUrl?: string;
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
        const raw = await client.getJson<SocialHotMatchApiItem[] | { matches?: SocialHotMatchApiItem[] }>(
          "/api/social/hot-matches"
        );

        const items = Array.isArray(raw) ? raw : Array.isArray(raw?.matches) ? raw.matches : [];

        const matches = items
          .filter((item) => (item.hotScore ?? item.HotScore ?? 0) >= minHotScore)
          .slice(0, limit)
          .map((item) => ({
            matchId: item.matchId ?? item.MatchId ?? 0,
            homeSymbol: item.homeSymbol ?? item.HomeSymbol ?? "",
            awaySymbol: item.awaySymbol ?? item.AwaySymbol ?? "",
            score: `${item.homeGoals ?? item.HomeGoals ?? 0} x ${item.awayGoals ?? item.AwayGoals ?? 0}`,
            status: item.status ?? item.Status ?? "",
            minute: item.minute ?? item.Minute ?? 0,
            hotScore: item.hotScore ?? item.HotScore ?? 0,
            reason: item.reason ?? item.Reason ?? "",
            publicUrl: client.toPublicUrl(item.publicUrl ?? item.PublicUrl)
          }));

        return toToolJsonResult({ matches });
      } catch (error) {
        return formatToolErrorResult(error);
      }
    }
  );
}
