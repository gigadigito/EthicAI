-- =============================================================================
-- 03_push_notification_validate.sql
-- POST-DEPLOY VALIDATION SCRIPT — READ ONLY
-- =============================================================================
-- Purpose: Validate that all Push Notification schema objects were created
--          correctly after running 02 or 02b apply script.
-- Date:    2026-08-08
-- Expected result: VALIDATION_RESULT = OK
-- =============================================================================
-- Output: One deterministic row per expected object (OK / MISMATCH / MISSING).
--         Summary line VALIDATION_RESULT = OK only when every check passes.
-- =============================================================================
-- All helpers are created in pg_temp — no persistent objects left behind.
-- All catalog lookups use explicit public schema — no search_path dependency.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: confdeltype → human-readable ON DELETE action
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp._cv_confdeltype(dt "char") RETURNS text AS $$
BEGIN
    RETURN CASE dt::text
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
        ELSE 'UNKNOWN(' || dt::text || ')'
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: normalize PostgreSQL default to a comparable form
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp._cv_normalize_default(d text) RETURNS text AS $$
BEGIN
    IF d IS NULL THEN RETURN '__NULL__'; END IF;
    WHILE d LIKE '(%' AND d LIKE '%)' AND length(d) > 2 LOOP
        d := trim(both '()' from d);
    END LOOP;
    IF d ~ '::\w' THEN d := split_part(d, '::', 1); END IF;
    IF d LIKE '''%''' AND length(d) >= 2 THEN d := trim(both '''' from d); END IF;
    IF d ~* '^now\(\)(\s*at time zone.*)?$' THEN RETURN 'NOW()'; END IF;
    IF d = 'true' THEN RETURN 'TRUE'; END IF;
    IF d = 'false' THEN RETURN 'FALSE'; END IF;
    IF d = 'en' THEN RETURN 'en'; END IF;
    IF d = 'PENDING' THEN RETURN 'PENDING'; END IF;
    IF d = '0' THEN RETURN '0'; END IF;
    RETURN d;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: normalize index filter predicate for comparison
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp._cv_normalize_filter(d text) RETURNS text AS $$
BEGIN
    IF d IS NULL THEN RETURN NULL; END IF;
    d := regexp_replace(d, '::\w+', '', 'g');
    d := replace(d, ' ', '');
    d := replace(d, '"', '');
    d := replace(d, '''', '');
    d := replace(d, '(', '');
    d := replace(d, ')', '');
    d := lower(d);
    RETURN d;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Temp table for deterministic output
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _cv_results;
CREATE TEMPORARY TABLE _cv_results (
    object_name text PRIMARY KEY,
    status text NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Validation: all checks in a single DO block
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    i int;
    v_actual text;
    v_idx_unique boolean;
    v_idx_cols name[];
    v_idx_filter text;
    v_defaults text[][] := ARRAY[
        ARRAY['push_subscription', 'dt_created', 'NOW()'],
        ARRAY['push_subscription', 'dt_updated', 'NOW()'],
        ARRAY['push_subscription', 'is_active', 'TRUE'],
        ARRAY['match_alert_subscription', 'is_notify_score', 'TRUE'],
        ARRAY['match_alert_subscription', 'is_notify_comeback', 'TRUE'],
        ARRAY['match_alert_subscription', 'is_notify_finished', 'TRUE'],
        ARRAY['match_alert_subscription', 'tx_culture', 'en'],
        ARRAY['match_alert_subscription', 'dt_created', 'NOW()'],
        ARRAY['match_alert_subscription', 'is_active', 'TRUE'],
        ARRAY['match_alert_delivery', 'tx_status', 'PENDING'],
        ARRAY['match_alert_delivery', 'nr_attempts', '0'],
        ARRAY['match_alert_delivery', 'dt_next_attempt', 'NOW()'],
        ARRAY['match_alert_delivery', 'dt_created', 'NOW()'],
        ARRAY['match_score_state', 'nr_last_goal_event_sequence', '0']
    ];
    v_fks text[][] := ARRAY[
        ARRAY['push_subscription', 'cd_user', 'user', 'cd_user', 'SET NULL'],
        ARRAY['match_alert_subscription', 'cd_push_subscription', 'push_subscription', 'cd_push_subscription', 'CASCADE'],
        ARRAY['match_alert_subscription', 'cd_match', 'match', 'cd_match', 'CASCADE'],
        ARRAY['match_alert_delivery', 'cd_push_subscription', 'push_subscription', 'cd_push_subscription', 'CASCADE'],
        ARRAY['match_alert_delivery', 'cd_match', 'match', 'cd_match', 'CASCADE'],
        ARRAY['match_alert_delivery', 'cd_match_score_event', 'match_score_event', 'cd_match_score_event', 'SET NULL']
    ];
    v_pks text[][] := ARRAY[
        ARRAY['push_subscription', 'cd_push_subscription'],
        ARRAY['match_alert_subscription', 'cd_match_alert_subscription'],
        ARRAY['match_alert_delivery', 'cd_match_alert_delivery']
    ];
BEGIN
    -- ═══════════════════════════════════════════════════════════════════════
    -- 1. Table existence
    -- ═══════════════════════════════════════════════════════════════════════
    INSERT INTO _cv_results SELECT 'push_subscription',
        CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'push_subscription' AND table_schema = 'public') THEN 'OK' ELSE 'MISSING' END;
    INSERT INTO _cv_results SELECT 'match_alert_subscription',
        CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'match_alert_subscription' AND table_schema = 'public') THEN 'OK' ELSE 'MISSING' END;
    INSERT INTO _cv_results SELECT 'match_alert_delivery',
        CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'match_alert_delivery' AND table_schema = 'public') THEN 'OK' ELSE 'MISSING' END;

    -- ═══════════════════════════════════════════════════════════════════════
    -- 2. Primary keys
    -- ═══════════════════════════════════════════════════════════════════════
    FOR i IN 1..array_length(v_pks, 1) LOOP
        INSERT INTO _cv_results SELECT v_pks[i][1] || '.pk',
            CASE WHEN EXISTS (
                SELECT 1 FROM pg_constraint c
                JOIN pg_class c1 ON c1.oid = c.conrelid
                JOIN pg_namespace n1 ON n1.oid = c1.relnamespace
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
                WHERE c1.relname = v_pks[i][1] AND n1.nspname = 'public'
                  AND c.contype = 'p' AND a.attname = v_pks[i][2]
            ) THEN 'OK' ELSE 'MISSING' END;
    END LOOP;

    -- ═══════════════════════════════════════════════════════════════════════
    -- 3. Foreign keys
    -- ═══════════════════════════════════════════════════════════════════════
    FOR i IN 1..array_length(v_fks, 1) LOOP
        INSERT INTO _cv_results SELECT v_fks[i][1] || '.fk_' || v_fks[i][3],
            CASE WHEN EXISTS (
                SELECT 1 FROM pg_constraint c
                JOIN pg_class c1 ON c1.oid = c.conrelid
                JOIN pg_namespace n1 ON n1.oid = c1.relnamespace
                JOIN pg_attribute a1 ON a1.attrelid = c.conrelid AND a1.attnum = ANY(c.conkey)
                WHERE c1.relname = v_fks[i][1] AND n1.nspname = 'public'
                  AND a1.attname = v_fks[i][2]
                  AND c.contype = 'f'
                  AND (SELECT c2.relname FROM pg_class c2 WHERE c2.oid = c.confrelid) = v_fks[i][3]
                  AND (SELECT a3.attname FROM pg_attribute a3 WHERE a3.attrelid = c.confrelid AND a3.attnum = ANY(c.confkey)) = v_fks[i][4]
                  AND pg_temp._cv_confdeltype(c.confdeltype) = v_fks[i][5]
            ) THEN 'OK'
            WHEN EXISTS (
                SELECT 1 FROM pg_constraint c
                JOIN pg_class c1 ON c1.oid = c.conrelid
                JOIN pg_namespace n1 ON n1.oid = c1.relnamespace
                JOIN pg_attribute a1 ON a1.attrelid = c.conrelid AND a1.attnum = ANY(c.conkey)
                WHERE c1.relname = v_fks[i][1] AND n1.nspname = 'public'
                  AND a1.attname = v_fks[i][2] AND c.contype = 'f'
            ) THEN 'MISMATCH'
            ELSE 'MISSING'
            END;
    END LOOP;

    -- ═══════════════════════════════════════════════════════════════════════
    -- 4. Indexes — semantic validation of uniqueness, columns, and filter
    -- ═══════════════════════════════════════════════════════════════════════

    -- ux_push_subscription_endpoint: UNIQUE on (tx_endpoint) WHERE is_active = true
    SELECT i.indisunique, array_agg(a.attname ORDER BY k.n), pg_get_expr(i.indpred, i.indrelid)
    INTO v_idx_unique, v_idx_cols, v_idx_filter
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, n)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE c.relname = 'ux_push_subscription_endpoint' AND n.nspname = 'public'
      AND i.indrelid = 'public.push_subscription'::regclass
    GROUP BY i.indisunique, i.indpred, i.indrelid;

    INSERT INTO _cv_results SELECT 'push_subscription.ux_endpoint',
        CASE
            WHEN v_idx_unique IS NULL THEN 'MISSING'
            WHEN NOT v_idx_unique THEN 'MISMATCH: not unique'
            WHEN v_idx_cols != ARRAY['tx_endpoint']::name[] THEN 'MISMATCH: cols=' || array_to_string(v_idx_cols, ',')
            WHEN pg_temp._cv_normalize_filter(v_idx_filter) != pg_temp._cv_normalize_filter('(is_active = true)') THEN 'MISMATCH: filter=' || COALESCE(v_idx_filter, '(none)')
            ELSE 'OK'
        END;

    -- ix_push_subscription_client: NON-UNIQUE on (tx_client_id) WHERE is_active = true
    SELECT i.indisunique, array_agg(a.attname ORDER BY k.n), pg_get_expr(i.indpred, i.indrelid)
    INTO v_idx_unique, v_idx_cols, v_idx_filter
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, n)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE c.relname = 'ix_push_subscription_client' AND n.nspname = 'public'
      AND i.indrelid = 'public.push_subscription'::regclass
    GROUP BY i.indisunique, i.indpred, i.indrelid;

    INSERT INTO _cv_results SELECT 'push_subscription.ix_client',
        CASE
            WHEN v_idx_unique IS NULL THEN 'MISSING'
            WHEN v_idx_unique THEN 'MISMATCH: unique'
            WHEN v_idx_cols != ARRAY['tx_client_id']::name[] THEN 'MISMATCH: cols=' || array_to_string(v_idx_cols, ',')
            WHEN pg_temp._cv_normalize_filter(v_idx_filter) != pg_temp._cv_normalize_filter('(is_active = true)') THEN 'MISMATCH: filter=' || COALESCE(v_idx_filter, '(none)')
            ELSE 'OK'
        END;

    -- ux_match_alert_subscription_sub_match: UNIQUE on (cd_push_subscription, cd_match) WHERE is_active = true
    SELECT i.indisunique, array_agg(a.attname ORDER BY k.n), pg_get_expr(i.indpred, i.indrelid)
    INTO v_idx_unique, v_idx_cols, v_idx_filter
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, n)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE c.relname = 'ux_match_alert_subscription_sub_match' AND n.nspname = 'public'
      AND i.indrelid = 'public.match_alert_subscription'::regclass
    GROUP BY i.indisunique, i.indpred, i.indrelid;

    INSERT INTO _cv_results SELECT 'match_alert_subscription.ux_sub_match',
        CASE
            WHEN v_idx_unique IS NULL THEN 'MISSING'
            WHEN NOT v_idx_unique THEN 'MISMATCH: not unique'
            WHEN v_idx_cols != ARRAY['cd_push_subscription', 'cd_match']::name[] THEN 'MISMATCH: cols=' || array_to_string(v_idx_cols, ',')
            WHEN pg_temp._cv_normalize_filter(v_idx_filter) != pg_temp._cv_normalize_filter('(is_active = true)') THEN 'MISMATCH: filter=' || COALESCE(v_idx_filter, '(none)')
            ELSE 'OK'
        END;

    -- ix_match_alert_subscription_match: NON-UNIQUE on (cd_match) WHERE is_active = true
    SELECT i.indisunique, array_agg(a.attname ORDER BY k.n), pg_get_expr(i.indpred, i.indrelid)
    INTO v_idx_unique, v_idx_cols, v_idx_filter
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, n)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE c.relname = 'ix_match_alert_subscription_match' AND n.nspname = 'public'
      AND i.indrelid = 'public.match_alert_subscription'::regclass
    GROUP BY i.indisunique, i.indpred, i.indrelid;

    INSERT INTO _cv_results SELECT 'match_alert_subscription.ix_match',
        CASE
            WHEN v_idx_unique IS NULL THEN 'MISSING'
            WHEN v_idx_unique THEN 'MISMATCH: unique'
            WHEN v_idx_cols != ARRAY['cd_match']::name[] THEN 'MISMATCH: cols=' || array_to_string(v_idx_cols, ',')
            WHEN pg_temp._cv_normalize_filter(v_idx_filter) != pg_temp._cv_normalize_filter('(is_active = true)') THEN 'MISMATCH: filter=' || COALESCE(v_idx_filter, '(none)')
            ELSE 'OK'
        END;

    -- ux_match_alert_delivery_sub_event_type: UNIQUE on (cd_push_subscription, tx_event_key, tx_alert_type) — no filter
    SELECT i.indisunique, array_agg(a.attname ORDER BY k.n), pg_get_expr(i.indpred, i.indrelid)
    INTO v_idx_unique, v_idx_cols, v_idx_filter
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, n)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE c.relname = 'ux_match_alert_delivery_sub_event_type' AND n.nspname = 'public'
      AND i.indrelid = 'public.match_alert_delivery'::regclass
    GROUP BY i.indisunique, i.indpred, i.indrelid;

    INSERT INTO _cv_results SELECT 'match_alert_delivery.ux_sub_event_type',
        CASE
            WHEN v_idx_unique IS NULL THEN 'MISSING'
            WHEN NOT v_idx_unique THEN 'MISMATCH: not unique'
            WHEN v_idx_cols != ARRAY['cd_push_subscription', 'tx_event_key', 'tx_alert_type']::name[] THEN 'MISMATCH: cols=' || array_to_string(v_idx_cols, ',')
            WHEN v_idx_filter IS NOT NULL THEN 'MISMATCH: unexpected filter=' || v_idx_filter
            ELSE 'OK'
        END;

    -- ix_match_alert_delivery_eligible: NON-UNIQUE on (dt_next_attempt) WHERE tx_status = 'PENDING'
    SELECT i.indisunique, array_agg(a.attname ORDER BY k.n), pg_get_expr(i.indpred, i.indrelid)
    INTO v_idx_unique, v_idx_cols, v_idx_filter
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, n)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE c.relname = 'ix_match_alert_delivery_eligible' AND n.nspname = 'public'
      AND i.indrelid = 'public.match_alert_delivery'::regclass
    GROUP BY i.indisunique, i.indpred, i.indrelid;

    INSERT INTO _cv_results SELECT 'match_alert_delivery.ix_eligible',
        CASE
            WHEN v_idx_unique IS NULL THEN 'MISSING'
            WHEN v_idx_unique THEN 'MISMATCH: unique'
            WHEN v_idx_cols != ARRAY['dt_next_attempt']::name[] THEN 'MISMATCH: cols=' || array_to_string(v_idx_cols, ',')
            WHEN pg_temp._cv_normalize_filter(v_idx_filter) != pg_temp._cv_normalize_filter('(tx_status = ''PENDING'')') THEN 'MISMATCH: filter=' || COALESCE(v_idx_filter, '(none)')
            ELSE 'OK'
        END;

    -- ix_match_alert_delivery_stuck: NON-UNIQUE on (dt_last_attempt) WHERE tx_status = 'PROCESSING'
    SELECT i.indisunique, array_agg(a.attname ORDER BY k.n), pg_get_expr(i.indpred, i.indrelid)
    INTO v_idx_unique, v_idx_cols, v_idx_filter
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, n)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE c.relname = 'ix_match_alert_delivery_stuck' AND n.nspname = 'public'
      AND i.indrelid = 'public.match_alert_delivery'::regclass
    GROUP BY i.indisunique, i.indpred, i.indrelid;

    INSERT INTO _cv_results SELECT 'match_alert_delivery.ix_stuck',
        CASE
            WHEN v_idx_unique IS NULL THEN 'MISSING'
            WHEN v_idx_unique THEN 'MISMATCH: unique'
            WHEN v_idx_cols != ARRAY['dt_last_attempt']::name[] THEN 'MISMATCH: cols=' || array_to_string(v_idx_cols, ',')
            WHEN pg_temp._cv_normalize_filter(v_idx_filter) != pg_temp._cv_normalize_filter('(tx_status = ''PROCESSING'')') THEN 'MISMATCH: filter=' || COALESCE(v_idx_filter, '(none)')
            ELSE 'OK'
        END;

    -- ═══════════════════════════════════════════════════════════════════════
    -- 5. Defaults — semantic comparison via pg_temp._cv_normalize_default
    -- ═══════════════════════════════════════════════════════════════════════
    FOR i IN 1..array_length(v_defaults, 1) LOOP
        SELECT column_default INTO v_actual
        FROM information_schema.columns
        WHERE table_name = v_defaults[i][1] AND table_schema = 'public'
          AND column_name = v_defaults[i][2];

        INSERT INTO _cv_results SELECT v_defaults[i][1] || '.default.' || v_defaults[i][2],
            CASE
                WHEN NOT FOUND THEN 'MISSING'
                WHEN pg_temp._cv_normalize_default(v_actual) = pg_temp._cv_normalize_default(v_defaults[i][3]) THEN 'OK'
                ELSE 'MISMATCH: ' || COALESCE(v_actual, '(none)')
            END;
    END LOOP;

    -- ═══════════════════════════════════════════════════════════════════════
    -- 6. match_score_state columns
    -- ═══════════════════════════════════════════════════════════════════════
    INSERT INTO _cv_results SELECT 'match_score_state.cd_last_undisputed_leader',
        CASE
            WHEN EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'match_score_state' AND table_schema = 'public'
                  AND column_name = 'cd_last_undisputed_leader'
                  AND data_type = 'integer' AND is_nullable = 'YES'
            ) THEN 'OK'
            WHEN EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'match_score_state' AND table_schema = 'public'
                  AND column_name = 'cd_last_undisputed_leader'
            ) THEN 'MISMATCH'
            ELSE 'MISSING'
        END;

    INSERT INTO _cv_results SELECT 'match_score_state.nr_last_goal_event_sequence',
        CASE
            WHEN EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'match_score_state' AND table_schema = 'public'
                  AND column_name = 'nr_last_goal_event_sequence'
                  AND data_type = 'integer' AND is_nullable = 'NO'
                  AND pg_temp._cv_normalize_default(column_default) = '0'
            ) THEN 'OK'
            WHEN EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'match_score_state' AND table_schema = 'public'
                  AND column_name = 'nr_last_goal_event_sequence'
            ) THEN 'MISMATCH'
            ELSE 'MISSING'
        END;

    -- ═══════════════════════════════════════════════════════════════════════
    -- 7. Migration history
    -- ═══════════════════════════════════════════════════════════════════════
    INSERT INTO _cv_results SELECT 'migration_history',
        CASE WHEN EXISTS (
            SELECT 1 FROM public."__EFMigrationsHistory"
            WHERE "MigrationId" = '20260808000000_AddPushNotificationTables'
              AND "ProductVersion" = '8.0.8'
        ) THEN 'OK'
        WHEN EXISTS (
            SELECT 1 FROM public."__EFMigrationsHistory"
            WHERE "MigrationId" = '20260808000000_AddPushNotificationTables'
        ) THEN 'MISMATCH'
        ELSE 'MISSING'
        END;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Output: deterministic results (one row per expected object)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT rpad(object_name, 50) || status AS result
FROM _cv_results ORDER BY object_name;

SELECT '';

SELECT 'VALIDATION_RESULT = '
    || CASE WHEN EXISTS (SELECT 1 FROM _cv_results WHERE status != 'OK')
            THEN 'FAILED'
            ELSE 'OK'
       END;

-- ─────────────────────────────────────────────────────────────────────────────
-- Informational: row counts (should be 0 for new installation)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'push_subscription.rows' AS object, COUNT(*)::text AS status
FROM public."push_subscription"
UNION ALL
SELECT 'match_alert_subscription.rows', COUNT(*)::text
FROM public."match_alert_subscription"
UNION ALL
SELECT 'match_alert_delivery.rows', COUNT(*)::text
FROM public."match_alert_delivery";

-- ─────────────────────────────────────────────────────────────────────────────
-- Informational: sequences
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'sequence.' || sequence_name AS object, 'OK' AS status
FROM information_schema.sequences
WHERE sequence_name IN (
    'push_subscription_cd_push_subscription_seq',
    'match_alert_subscription_cd_match_alert_subscription_seq',
    'match_alert_delivery_cd_match_alert_delivery_seq'
)
ORDER BY sequence_name;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cleanup: temp table only. pg_temp functions auto-drop when session ends.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _cv_results;
