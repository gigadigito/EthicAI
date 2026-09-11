-- =============================================================================
-- 04_push_notification_rollback.sql
-- ROLLBACK SCRIPT — DESTRUCTIVE, USE WITH CAUTION
-- =============================================================================
-- WARNING: This script WILL PERMANENTLY DELETE all Push Notification data:
--          - All browser push subscriptions
--          - All match alert subscriptions
--          - All match alert delivery records
--          - Comeback detection columns from match_score_state
--          - Migration history record
--
-- This data CANNOT be recovered after execution.
-- Users will need to re-subscribe to notifications.
--
-- Date:    2026-08-08
-- MigrationId: 20260808000000_AddPushNotificationTables
-- =============================================================================
--
-- CONDITIONS FOR SAFE EXECUTION:
--
-- This rollback is ONLY safe when ALL of the following are true:
--
-- 1. The migration 20260808000000_AddPushNotificationTables was applied
--    using the 02_apply.sql or 02b_apply_idempotent.sql script from this
--    repository.
--
-- 2. The 3 target tables (push_subscription, match_alert_subscription,
--    match_alert_delivery) and 2 columns (cd_last_undisputed_leader,
--    nr_last_goal_event_sequence) were introduced EXCLUSIVELY by this
--    migration. If these objects existed BEFORE the migration was applied,
--    this rollback will destroy pre-existing data.
--
-- 3. No other migration or manual DDL has modified these objects since
--    the migration was applied (e.g., added columns, renamed constraints,
--    created dependent objects).
--
-- 4. No production process is actively reading or writing to these tables.
--    The Worker's PushNotificationDispatcher polls match_alert_delivery;
--    stop the Worker before executing.
--
-- IF YOU CANNOT CONFIRM CONDITION #2, DO NOT RUN THIS SCRIPT.
-- Instead, manually inspect each object to determine what was pre-existing
-- and only drop what was introduced by this migration.
--
-- ROLLBACK SEQUENCE:
--   The objects are dropped in reverse dependency order:
--     1. __EFMigrationsHistory record
--     2. match_alert_delivery (depends on push_subscription, match, match_score_event)
--     3. match_alert_subscription (depends on push_subscription, match)
--     4. push_subscription (includes FK to user)
--     5. match_score_state columns (cd_last_undisputed_leader, nr_last_goal_event_sequence)
--     6. Sequences
-- =============================================================================
-- All references use explicit public schema — no search_path dependency.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: Remove migration history record
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM public."__EFMigrationsHistory"
WHERE "MigrationId" = '20260808000000_AddPushNotificationTables';

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: Drop match_alert_delivery (depends on push_subscription, match, match_score_event)
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public."ix_match_alert_delivery_stuck";
DROP INDEX IF EXISTS public."ix_match_alert_delivery_eligible";
DROP INDEX IF EXISTS public."ux_match_alert_delivery_sub_event_type";
DROP TABLE IF EXISTS public."match_alert_delivery";

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: Drop match_alert_subscription (depends on push_subscription, match)
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public."ix_match_alert_subscription_match";
DROP INDEX IF EXISTS public."ux_match_alert_subscription_sub_match";
DROP TABLE IF EXISTS public."match_alert_subscription";

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: Drop push_subscription (includes FK to user)
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public."ix_push_subscription_client";
DROP INDEX IF EXISTS public."ux_push_subscription_endpoint";
DROP TABLE IF EXISTS public."push_subscription";

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5: Remove comeback detection columns from match_score_state
--         WARNING: This removes cd_last_undisputed_leader and
--                  nr_last_goal_event_sequence from all existing rows.
--                  Comeback detection will stop working immediately.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public."match_score_state"
    DROP COLUMN IF EXISTS "nr_last_goal_event_sequence",
    DROP COLUMN IF EXISTS "cd_last_undisputed_leader";

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6: Clean up sequences (bigserial sequences)
-- ─────────────────────────────────────────────────────────────────────────────
DROP SEQUENCE IF EXISTS public."push_subscription_cd_push_subscription_seq";
DROP SEQUENCE IF EXISTS public."match_alert_subscription_cd_match_alert_subscription_seq";
DROP SEQUENCE IF EXISTS public."match_alert_delivery_cd_match_alert_delivery_seq";

COMMIT;
