-- =============================================================================
-- 01_push_notification_precheck.sql
-- PRE-VALIDATION SCRIPT — READ ONLY, NO CHANGES
-- =============================================================================
-- Purpose: Verify if production database is ready to receive Push Notification
--          schema changes. Run this BEFORE the apply script.
-- Date:    2026-08-08
-- MigrationId: 20260808000000_AddPushNotificationTables
--
-- ProductVersion 8.0.8 evidence:
--   - DAL.csproj: Microsoft.EntityFrameworkCore 8.0.8
--   - DAL.csproj: Npgsql.EntityFrameworkCore.PostgreSQL 8.0.8
--   - Last Designer.cs (20260604175603): HasAnnotation("ProductVersion", "8.0.8")
--   - First Designer.cs (20250525221104): HasAnnotation("ProductVersion", "8.0.8")
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Check if target tables already exist (EXISTS against pg_class + public)
--    Exactly one row per target. No duplicate rows from other schemas.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
    targets.t AS table_name,
    CASE WHEN EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = targets.t AND c.relkind = 'r' AND n.nspname = 'public'
    ) THEN 'EXISTS' ELSE 'MISSING' END AS status
FROM (
    SELECT 'push_subscription' AS t
    UNION ALL SELECT 'match_alert_subscription'
    UNION ALL SELECT 'match_alert_delivery'
) targets
ORDER BY targets.t;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Check columns in existing target tables (if they exist)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
    t.table_name,
    c.column_name,
    c.data_type,
    c.character_maximum_length,
    c.is_nullable,
    c.column_default
FROM information_schema.tables t
JOIN information_schema.columns c ON c.table_name = t.table_name AND c.table_schema = 'public'
WHERE t.table_name IN ('push_subscription', 'match_alert_subscription', 'match_alert_delivery')
  AND t.table_schema = 'public'
ORDER BY t.table_name, c.ordinal_position;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Check indexes on target tables
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename IN ('push_subscription', 'match_alert_subscription', 'match_alert_delivery')
  AND schemaname = 'public'
ORDER BY tablename, indexname;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Check foreign keys on target tables
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints rc
    ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
WHERE tc.table_name IN ('push_subscription', 'match_alert_subscription', 'match_alert_delivery')
  AND tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Check new columns on match_score_state
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
    c.column_name,
    c.data_type,
    c.is_nullable,
    c.column_default
FROM information_schema.columns c
WHERE c.table_name = 'match_score_state'
  AND c.table_schema = 'public'
  AND c.column_name IN ('cd_last_undisputed_leader', 'nr_last_goal_event_sequence')
ORDER BY c.column_name;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Check __EFMigrationsHistory for this migration
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
    "MigrationId",
    "ProductVersion"
FROM public."__EFMigrationsHistory"
WHERE "MigrationId" = '20260808000000_AddPushNotificationTables';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. List last 10 migrations in history
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
    "MigrationId",
    "ProductVersion"
FROM public."__EFMigrationsHistory"
ORDER BY "MigrationId" DESC
LIMIT 10;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Check if required parent tables exist with column types (schema-scoped)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
    t.table_name,
    EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = t.table_name
    ) AS exists_in_public,
    (SELECT c.data_type FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = t.table_name AND c.column_name = t.pk_col
    ) AS pk_column_type
FROM (VALUES
    ('user', 'cd_user'),
    ('match', 'cd_match'),
    ('match_score_event', 'cd_match_score_event')
) AS t(table_name, pk_col)
ORDER BY t.table_name;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Check for potential naming collisions (schema-scoped)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
    c.relname AS object_name,
    CASE c.relkind
        WHEN 'r' THEN 'TABLE'
        WHEN 'i' THEN 'INDEX'
        WHEN 'S' THEN 'SEQUENCE'
        ELSE 'OTHER'
    END AS object_type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relname LIKE '%push%' OR c.relname LIKE '%alert%'
ORDER BY c.relname;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. SUMMARY — Single-line quick review
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
    (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_name = 'push_subscription' AND table_schema = 'public') AS push_subscription_exists,
    (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_name = 'match_alert_subscription' AND table_schema = 'public') AS match_alert_subscription_exists,
    (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_name = 'match_alert_delivery' AND table_schema = 'public') AS match_alert_delivery_exists,
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_name = 'match_score_state' AND column_name = 'cd_last_undisputed_leader'
       AND table_schema = 'public') AS leader_column_exists,
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_name = 'match_score_state' AND column_name = 'nr_last_goal_event_sequence'
       AND table_schema = 'public') AS goal_seq_column_exists,
    (SELECT COUNT(*) FROM public."__EFMigrationsHistory"
     WHERE "MigrationId" = '20260808000000_AddPushNotificationTables') AS migration_applied;
