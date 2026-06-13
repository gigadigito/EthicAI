using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;

namespace DAL.NftFutebol;

public static class MatchScoreStateSchema
{
    public static async Task EnsureCandleBattleColumnsAsync(EthicAIDbContext db, CancellationToken ct = default)
    {
        const string sql = """
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'match_score_state'
    ) THEN
        ALTER TABLE public.match_score_state ADD COLUMN IF NOT EXISTS nr_candle_battle_wins_a integer NOT NULL DEFAULT 0;
        ALTER TABLE public.match_score_state ADD COLUMN IF NOT EXISTS nr_candle_battle_wins_b integer NOT NULL DEFAULT 0;
        ALTER TABLE public.match_score_state ADD COLUMN IF NOT EXISTS cd_last_candle_battle_leader integer NULL;
        ALTER TABLE public.match_score_state ADD COLUMN IF NOT EXISTS dt_last_candle_battle_processed_at timestamp with time zone NULL;
        ALTER TABLE public.match_score_state ADD COLUMN IF NOT EXISTS nr_last_candle_battle_close_price_a numeric(28, 8) NULL;
        ALTER TABLE public.match_score_state ADD COLUMN IF NOT EXISTS nr_last_candle_battle_close_price_b numeric(28, 8) NULL;
        ALTER TABLE public.match_score_state ADD COLUMN IF NOT EXISTS nr_last_candle_battle_left_wins integer NOT NULL DEFAULT 0;
        ALTER TABLE public.match_score_state ADD COLUMN IF NOT EXISTS nr_last_candle_battle_right_wins integer NOT NULL DEFAULT 0;
        ALTER TABLE public.match_score_state ADD COLUMN IF NOT EXISTS cd_last_candle_battle_dominance_team integer NULL;
        ALTER TABLE public.match_score_state ADD COLUMN IF NOT EXISTS tx_last_candle_battle_state_key text NULL;
    END IF;
END $$;
""";

        await db.Database.ExecuteSqlRawAsync(sql, ct);
    }

    public static async Task EnsureArenaPressureColumnsAsync(EthicAIDbContext db, CancellationToken ct = default)
    {
        const string sql = """
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'match_score_state'
    ) THEN
        ALTER TABLE public.match_score_state ADD COLUMN IF NOT EXISTS nr_pressure_charges_a integer NOT NULL DEFAULT 0;
        ALTER TABLE public.match_score_state ADD COLUMN IF NOT EXISTS nr_pressure_charges_b integer NOT NULL DEFAULT 0;
        ALTER TABLE public.match_score_state ADD COLUMN IF NOT EXISTS nr_pressure_goals_awarded integer NOT NULL DEFAULT 0;
        ALTER TABLE public.match_score_state ADD COLUMN IF NOT EXISTS cd_last_pressure_leader integer NULL;
        ALTER TABLE public.match_score_state ADD COLUMN IF NOT EXISTS nr_last_pressure_leader_cycles integer NOT NULL DEFAULT 0;
        ALTER TABLE public.match_score_state ADD COLUMN IF NOT EXISTS dt_last_pressure_goal_a timestamp with time zone NULL;
        ALTER TABLE public.match_score_state ADD COLUMN IF NOT EXISTS dt_last_pressure_goal_b timestamp with time zone NULL;
        ALTER TABLE public.match_score_state ADD COLUMN IF NOT EXISTS cd_current_pressure_dominance_leader integer NULL;
        ALTER TABLE public.match_score_state ADD COLUMN IF NOT EXISTS dt_current_pressure_dominance_started timestamp with time zone NULL;
        ALTER TABLE public.match_score_state ADD COLUMN IF NOT EXISTS fl_current_pressure_dominance_resolved boolean NOT NULL DEFAULT false;
        ALTER TABLE public.match_score_state ADD COLUMN IF NOT EXISTS fl_current_pressure_dominance_goal_awarded boolean NOT NULL DEFAULT false;
    END IF;
END $$;
""";

        await db.Database.ExecuteSqlRawAsync(sql, ct);
    }

    public static async Task EnsureAllAsync(EthicAIDbContext db, CancellationToken ct = default)
    {
        await EnsureCandleBattleColumnsAsync(db, ct);
        await EnsureArenaPressureColumnsAsync(db, ct);
    }
}
