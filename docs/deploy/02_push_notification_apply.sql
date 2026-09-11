-- =============================================================================
-- 02_push_notification_apply.sql
-- APPLY SCRIPT — STRICT, fails if any object already exists
-- =============================================================================
-- Purpose: Create all database objects required for Push Notifications.
--          Designed for use AFTER 01_push_notification_precheck.sql confirms
--          a clean environment (no target tables, no target columns).
-- Date:    2026-08-08
-- MigrationId: 20260808000000_AddPushNotificationTables
--
-- ProductVersion 8.0.8 evidence:
--   - DAL.csproj: Microsoft.EntityFrameworkCore 8.0.8
--   - DAL.csproj: Npgsql.EntityFrameworkCore.PostgreSQL 8.0.8
--   - Last Designer.cs (20260604175603): HasAnnotation("ProductVersion", "8.0.8")
--   - First Designer.cs (20250525221104): HasAnnotation("ProductVersion", "8.0.8")
-- =============================================================================
-- IMPORTANT: Execute inside a transaction. If any step fails, the entire
--            script rolls back safely.
--
-- This script will FAIL if:
--   - Any of the 3 target tables already exist
--   - The match_score_state columns already exist
--   - The migration record already exists
-- =============================================================================
-- tx_culture uses varchar(10) to match Fluent API HasMaxLength(10).
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 0: Pre-validate — abort if any target object already exists
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_name = 'push_subscription' AND table_schema = 'public') THEN
        RAISE EXCEPTION 'ABORT: push_subscription table already exists. Run 01_precheck.sql first.';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_name = 'match_alert_subscription' AND table_schema = 'public') THEN
        RAISE EXCEPTION 'ABORT: match_alert_subscription table already exists. Run 01_precheck.sql first.';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_name = 'match_alert_delivery' AND table_schema = 'public') THEN
        RAISE EXCEPTION 'ABORT: match_alert_delivery table already exists. Run 01_precheck.sql first.';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'match_score_state' AND table_schema = 'public'
                 AND column_name = 'cd_last_undisputed_leader') THEN
        RAISE EXCEPTION 'ABORT: match_score_state.cd_last_undisputed_leader already exists.';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'match_score_state' AND table_schema = 'public'
                 AND column_name = 'nr_last_goal_event_sequence') THEN
        RAISE EXCEPTION 'ABORT: match_score_state.nr_last_goal_event_sequence already exists.';
    END IF;
    IF EXISTS (SELECT 1 FROM public."__EFMigrationsHistory"
               WHERE "MigrationId" = '20260808000000_AddPushNotificationTables') THEN
        RAISE EXCEPTION 'ABORT: Migration 20260808000000_AddPushNotificationTables already recorded.';
    END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: Create push_subscription table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public."push_subscription" (
    "cd_push_subscription" bigserial PRIMARY KEY,
    "tx_endpoint"          text NOT NULL,
    "tx_p256dh"            text NOT NULL,
    "tx_auth"              text NOT NULL,
    "tx_client_id"         text NOT NULL,
    "cd_user"              integer NULL,
    "dt_created"           timestamp with time zone NOT NULL DEFAULT NOW(),
    "dt_updated"           timestamp with time zone NOT NULL DEFAULT NOW(),
    "is_active"            boolean NOT NULL DEFAULT TRUE
);

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: Indexes for push_subscription
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "ux_push_subscription_endpoint"
    ON public."push_subscription" ("tx_endpoint")
    WHERE "is_active" = TRUE;

CREATE INDEX "ix_push_subscription_client"
    ON public."push_subscription" ("tx_client_id")
    WHERE "is_active" = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: FK push_subscription.cd_user → user(cd_user)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public."push_subscription"
    ADD CONSTRAINT "fk_push_subscription_user"
    FOREIGN KEY ("cd_user") REFERENCES public."user"("cd_user")
    ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: Create match_alert_subscription table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public."match_alert_subscription" (
    "cd_match_alert_subscription" bigserial PRIMARY KEY,
    "cd_push_subscription"        bigint NOT NULL
        REFERENCES public."push_subscription"("cd_push_subscription") ON DELETE CASCADE,
    "cd_match"                    integer NOT NULL
        REFERENCES public."match"("cd_match") ON DELETE CASCADE,
    "is_notify_score"             boolean NOT NULL DEFAULT TRUE,
    "is_notify_comeback"          boolean NOT NULL DEFAULT TRUE,
    "is_notify_finished"          boolean NOT NULL DEFAULT TRUE,
    "tx_culture"                  varchar(10) NOT NULL DEFAULT 'en',
    "dt_created"                  timestamp with time zone NOT NULL DEFAULT NOW(),
    "is_active"                   boolean NOT NULL DEFAULT TRUE
);

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5: Indexes for match_alert_subscription
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "ux_match_alert_subscription_sub_match"
    ON public."match_alert_subscription" ("cd_push_subscription", "cd_match")
    WHERE "is_active" = TRUE;

CREATE INDEX "ix_match_alert_subscription_match"
    ON public."match_alert_subscription" ("cd_match")
    WHERE "is_active" = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6: Create match_alert_delivery table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public."match_alert_delivery" (
    "cd_match_alert_delivery" bigserial PRIMARY KEY,
    "cd_push_subscription"    bigint NOT NULL
        REFERENCES public."push_subscription"("cd_push_subscription") ON DELETE CASCADE,
    "cd_match"                integer NOT NULL
        REFERENCES public."match"("cd_match") ON DELETE CASCADE,
    "cd_match_score_event"    bigint NULL
        REFERENCES public."match_score_event"("cd_match_score_event") ON DELETE SET NULL,
    "tx_event_key"            text NOT NULL,
    "tx_alert_type"           text NOT NULL,
    "tx_status"               text NOT NULL DEFAULT 'PENDING',
    "nr_attempts"             integer NOT NULL DEFAULT 0,
    "dt_next_attempt"         timestamp with time zone NOT NULL DEFAULT NOW(),
    "dt_last_attempt"         timestamp with time zone NULL,
    "dt_sent"                 timestamp with time zone NULL,
    "dt_created"              timestamp with time zone NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 7: Indexes for match_alert_delivery
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "ux_match_alert_delivery_sub_event_type"
    ON public."match_alert_delivery" ("cd_push_subscription", "tx_event_key", "tx_alert_type");

CREATE INDEX "ix_match_alert_delivery_eligible"
    ON public."match_alert_delivery" ("dt_next_attempt")
    WHERE "tx_status" = 'PENDING';

CREATE INDEX "ix_match_alert_delivery_stuck"
    ON public."match_alert_delivery" ("dt_last_attempt")
    WHERE "tx_status" = 'PROCESSING';

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 8: Add comeback detection columns to match_score_state
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public."match_score_state"
    ADD COLUMN "cd_last_undisputed_leader" integer NULL,
    ADD COLUMN "nr_last_goal_event_sequence" integer NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 9: Register migration in __EFMigrationsHistory
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public."__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260808000000_AddPushNotificationTables', '8.0.8');

COMMIT;
