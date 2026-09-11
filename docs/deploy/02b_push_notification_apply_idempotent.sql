-- =============================================================================
-- 02b_push_notification_apply_idempotent.sql
-- APPLY SCRIPT — Idempotent version with structural validation
-- =============================================================================
-- Purpose: Create all database objects required for Push Notifications.
--          Safe to re-run. Validates actual structure, not just existence.
-- Date:    2026-08-08
-- MigrationId: 20260808000000_AddPushNotificationTables
--
-- ProductVersion 8.0.8 evidence:
--   - DAL.csproj: Microsoft.EntityFrameworkCore 8.0.8
--   - DAL.csproj: Npgsql.EntityFrameworkCore.PostgreSQL 8.0.8
--   - Last Designer.cs (20260604175603): HasAnnotation("ProductVersion", "8.0.8")
--   - First Designer.cs (20250525221104): HasAnnotation("ProductVersion", "8.0.8")
-- =============================================================================
-- WARNING: If a table/index/constraint exists with a DIFFERENT structure,
--          this script will FAIL with a clear error rather than silently
--          ignoring the incompatibility.
-- =============================================================================
-- tx_culture uses varchar(10) to match Fluent API HasMaxLength(10).
-- confdeltype mapping: a=NO ACTION, r=RESTRICT, c=CASCADE, n=SET NULL, d=SET DEFAULT
-- =============================================================================

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- Helper: confdeltype → human-readable ON DELETE action
-- ═════════════════════════════════════════════════════════════════════════════
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

-- ═════════════════════════════════════════════════════════════════════════════
-- Helper: normalize PostgreSQL default to a comparable form
-- ═════════════════════════════════════════════════════════════════════════════
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

-- ═════════════════════════════════════════════════════════════════════════════
-- Helper: validate index structure using pg_index catalogs
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION pg_temp._cv_validate_index(
    p_table_name text,
    p_index_name text,
    p_expected_unique boolean,
    p_expected_columns text[],
    p_expected_filter text
) RETURNS void AS $$
DECLARE
    v_index RECORD;
    v_indkey_result RECORD;
    v_actual_cols text[];
    v_actual_filter text;
    v_col RECORD;
    v_idx_pos int;
BEGIN
    -- Find the index
    SELECT i.indexrelid, i.indisunique, i.indrelid, i.indpred, i.indkey
    INTO v_index
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = p_index_name
      AND n.nspname = 'public'
      AND to_regclass(format('public.%I', p_table_name)) = i.indrelid;

    IF NOT FOUND THEN
        RAISE EXCEPTION '%.%: index does not exist', p_table_name, p_index_name;
    END IF;

    -- Check uniqueness
    IF v_index.indisunique <> p_expected_unique THEN
        RAISE EXCEPTION '%.%: expected %, got %',
            p_table_name, p_index_name,
            CASE WHEN p_expected_unique THEN 'UNIQUE' ELSE 'NON-UNIQUE' END,
            CASE WHEN v_index.indisunique THEN 'UNIQUE' ELSE 'NON-UNIQUE' END;
    END IF;

    -- Get index columns in order via pg_attribute + indkey
    SELECT array_agg(a.attname ORDER BY k.n) INTO v_actual_cols
    FROM unnest(v_index.indkey) WITH ORDINALITY AS k(attnum, n)
    JOIN pg_attribute a ON a.attrelid = v_index.indrelid AND a.attnum = k.attnum;

    -- Validate column count
    IF array_length(v_actual_cols, 1) <> array_length(p_expected_columns, 1) THEN
        RAISE EXCEPTION '%.%: expected % columns (%), got % (%)',
            p_table_name, p_index_name,
            array_length(p_expected_columns, 1), array_to_string(p_expected_columns, ','),
            array_length(v_actual_cols, 1), array_to_string(v_actual_cols, ',');
    END IF;

    -- Validate columns in order
    FOR v_idx_pos IN 1..array_length(p_expected_columns, 1) LOOP
        IF v_actual_cols[v_idx_pos] <> p_expected_columns[v_idx_pos] THEN
            RAISE EXCEPTION '%.%: column % at position % has wrong name. Expected %, got %',
                p_table_name, p_index_name, v_idx_pos,
                p_expected_columns[v_idx_pos], v_idx_pos, v_actual_cols[v_idx_pos];
        END IF;
    END LOOP;

    -- Validate partial index filter using pg_get_expr
    IF p_expected_filter IS NOT NULL THEN
        v_actual_filter := pg_get_expr(v_index.indpred, v_index.indrelid);
        IF v_actual_filter IS NULL THEN
            RAISE EXCEPTION '%.%: expected partial index with filter (%), but index has no filter',
                p_table_name, p_index_name, p_expected_filter;
        END IF;
        -- Normalize and compare filters
        IF pg_temp._cv_normalize_filter(v_actual_filter) <> pg_temp._cv_normalize_filter(p_expected_filter) THEN
            RAISE EXCEPTION '%.%: filter mismatch. Expected: %, Got: %',
                p_table_name, p_index_name, p_expected_filter, v_actual_filter;
        END IF;
    END IF;

    RAISE NOTICE '%.%: OK', p_table_name, p_index_name;
END;
$$ LANGUAGE plpgsql;

-- ═════════════════════════════════════════════════════════════════════════════
-- Helper: validate FK structure using pg_constraint
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION pg_temp._cv_validate_fk(
    p_from_table text,
    p_from_column text,
    p_to_table text,
    p_to_column text,
    p_expected_on_delete text
) RETURNS void AS $$
DECLARE
    v_con RECORD;
    v_on_delete text;
BEGIN
    SELECT
        a1.attname AS src_col,
        (SELECT c2.relname FROM pg_class c2 WHERE c2.oid = c.confrelid) AS ref_table,
        a2.attname AS ref_col,
        pg_temp._cv_confdeltype(c.confdeltype) AS on_delete
    INTO v_con
    FROM pg_constraint c
    JOIN pg_class c1 ON c1.oid = c.conrelid
    JOIN pg_namespace n1 ON n1.oid = c1.relnamespace
    JOIN pg_attribute a1 ON a1.attrelid = c.conrelid AND a1.attnum = ANY(c.conkey)
    JOIN pg_attribute a2 ON a2.attrelid = c.confrelid AND a2.attnum = ANY(c.confkey)
    WHERE c1.relname = p_from_table
      AND n1.nspname = 'public'
      AND a1.attname = p_from_column
      AND c.contype = 'f';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'FK %.% -> %.%: does not exist', p_from_table, p_from_column, p_to_table, p_to_column;
    END IF;

    -- Validate referenced table (strip quotes for comparison)
    IF replace(v_con.ref_table, '"', '') <> p_to_table THEN
        RAISE EXCEPTION 'FK %.%: references %, expected %',
            p_from_table, p_from_column, v_con.ref_table, p_to_table;
    END IF;

    -- Validate referenced column
    IF v_con.ref_col <> p_to_column THEN
        RAISE EXCEPTION 'FK %.%: references column %, expected %',
            p_from_table, p_from_column, v_con.ref_col, p_to_column;
    END IF;

    -- Validate ON DELETE
    IF v_con.on_delete <> p_expected_on_delete THEN
        RAISE EXCEPTION 'FK %.%: ON DELETE is %, expected %',
            p_from_table, p_from_column, v_con.on_delete, p_expected_on_delete;
    END IF;

    RAISE NOTICE 'FK %.% -> %.% ON DELETE %: OK',
        p_from_table, p_from_column, p_to_table, p_to_column, p_expected_on_delete;
END;
$$ LANGUAGE plpgsql;

-- ═════════════════════════════════════════════════════════════════════════════
-- Helper: create FK if missing
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION pg_temp._cv_create_fk_if_missing(
    p_from_table text,
    p_from_column text,
    p_to_table text,
    p_to_column text,
    p_on_delete text
) RETURNS void AS $$
DECLARE
    v_exists boolean;
    v_fk_name text;
BEGIN
    v_fk_name := 'fk_' || p_from_table || '_' || p_from_column;

    SELECT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class c1 ON c1.oid = c.conrelid
        JOIN pg_namespace n1 ON n1.oid = c1.relnamespace
        JOIN pg_attribute a1 ON a1.attrelid = c.conrelid AND a1.attnum = ANY(c.conkey)
        WHERE c1.relname = p_from_table
          AND n1.nspname = 'public'
          AND a1.attname = p_from_column
          AND c.contype = 'f'
    ) INTO v_exists;

    IF v_exists THEN
        RAISE NOTICE 'FK %.% already exists, skipping', p_from_table, p_from_column;
        RETURN;
    END IF;

    EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(%I) ON DELETE %s',
        p_from_table, v_fk_name, p_from_column, p_to_table, p_to_column, p_on_delete
    );
    RAISE NOTICE 'Created FK %.% -> %.% ON DELETE %',
        p_from_table, p_from_column, p_to_table, p_to_column, p_on_delete;
END;
$$ LANGUAGE plpgsql;

-- ═════════════════════════════════════════════════════════════════════════════
-- Helper: validate PK exists
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION pg_temp._cv_validate_pk(
    p_table_name text,
    p_pk_column text
) RETURNS void AS $$
DECLARE
    v_pk_col text;
BEGIN
    SELECT a.attname INTO v_pk_col
    FROM pg_constraint c
    JOIN pg_class c1 ON c1.oid = c.conrelid
    JOIN pg_namespace n1 ON n1.oid = c1.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c1.relname = p_table_name
      AND n1.nspname = 'public'
      AND c.contype = 'p';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PK on %: does not exist', p_table_name;
    END IF;

    IF v_pk_col <> p_pk_column THEN
        RAISE EXCEPTION 'PK on %: column is %, expected %', p_table_name, v_pk_col, p_pk_column;
    END IF;

    RAISE NOTICE 'PK %.%: OK', p_table_name, p_pk_column;
END;
$$ LANGUAGE plpgsql;

-- ═════════════════════════════════════════════════════════════════════════════
-- Helper: validate column defaults
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION pg_temp._cv_validate_default(
    p_table_name text,
    p_column_name text,
    p_expected_default text
) RETURNS void AS $$
DECLARE
    v_actual text;
BEGIN
    SELECT column_default INTO v_actual
    FROM information_schema.columns
    WHERE table_name = p_table_name
      AND table_schema = 'public'
      AND column_name = p_column_name;

    IF NOT FOUND THEN
        RAISE EXCEPTION '%.%: column does not exist', p_table_name, p_column_name;
    END IF;

    IF pg_temp._cv_normalize_default(v_actual) <> pg_temp._cv_normalize_default(p_expected_default) THEN
        RAISE EXCEPTION '%.%: default is %, expected %',
            p_table_name, p_column_name, v_actual, p_expected_default;
    END IF;

    RAISE NOTICE '%.%: default OK', p_table_name, p_column_name;
END;
$$ LANGUAGE plpgsql;


-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 1: push_subscription — structural validation
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    v_table_exists boolean;
    v_expected_columns text[] := ARRAY[
        'cd_push_subscription', 'tx_endpoint', 'tx_p256dh', 'tx_auth',
        'tx_client_id', 'cd_user', 'dt_created', 'dt_updated', 'is_active'
    ];
    v_expected_types text[] := ARRAY[
        'bigint', 'text', 'text', 'text',
        'text', 'integer', 'timestamp with time zone', 'timestamp with time zone', 'boolean'
    ];
    v_expected_nullable text[] := ARRAY[
        'NO', 'NO', 'NO', 'NO',
        'NO', 'YES', 'NO', 'NO', 'NO'
    ];
    v_idx int;
    v_actual_col record;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'push_subscription' AND table_schema = 'public'
    ) INTO v_table_exists;

    IF NOT v_table_exists THEN
        RAISE NOTICE 'push_subscription does not exist, will be created';
        RETURN;
    END IF;

    -- Validate PK
    PERFORM pg_temp._cv_validate_pk('push_subscription', 'cd_push_subscription');

    -- Validate columns
    FOR v_idx IN 1..array_length(v_expected_columns, 1) LOOP
        SELECT c.data_type, c.is_nullable INTO v_actual_col
        FROM information_schema.columns c
        WHERE c.table_name = 'push_subscription'
          AND c.table_schema = 'public'
          AND c.column_name = v_expected_columns[v_idx];

        IF NOT FOUND THEN
            RAISE EXCEPTION 'push_subscription: missing column %', v_expected_columns[v_idx];
        END IF;
        IF v_actual_col.data_type <> v_expected_types[v_idx] THEN
            RAISE EXCEPTION 'push_subscription: column % has type %, expected %',
                v_expected_columns[v_idx], v_actual_col.data_type, v_expected_types[v_idx];
        END IF;
        IF v_actual_col.is_nullable <> v_expected_nullable[v_idx] THEN
            RAISE EXCEPTION 'push_subscription: column % has nullable=%, expected %',
                v_expected_columns[v_idx], v_actual_col.is_nullable, v_expected_nullable[v_idx];
        END IF;
    END LOOP;

    -- Validate defaults
    PERFORM pg_temp._cv_validate_default('push_subscription', 'dt_created', 'NOW()');
    PERFORM pg_temp._cv_validate_default('push_subscription', 'dt_updated', 'NOW()');
    PERFORM pg_temp._cv_validate_default('push_subscription', 'is_active', 'TRUE');

    -- Validate indexes
    PERFORM pg_temp._cv_validate_index('push_subscription', 'ux_push_subscription_endpoint',
        true, ARRAY['tx_endpoint'], 'is_active = true');
    PERFORM pg_temp._cv_validate_index('push_subscription', 'ix_push_subscription_client',
        false, ARRAY['tx_client_id'], 'is_active = true');

    RAISE NOTICE 'push_subscription: structural validation OK';
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 1b: Create push_subscription if not exists
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public."push_subscription" (
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

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 1c: Create indexes if missing
-- ═════════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS "ux_push_subscription_endpoint"
    ON public."push_subscription" ("tx_endpoint")
    WHERE "is_active" = TRUE;

CREATE INDEX IF NOT EXISTS "ix_push_subscription_client"
    ON public."push_subscription" ("tx_client_id")
    WHERE "is_active" = TRUE;

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 1d: Create FK if missing (for existing tables without FK)
-- ═════════════════════════════════════════════════════════════════════════════
SELECT pg_temp._cv_create_fk_if_missing('push_subscription', 'cd_user', 'user', 'cd_user', 'SET NULL');

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 2: match_alert_subscription — structural validation
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    v_table_exists boolean;
    v_expected_columns text[] := ARRAY[
        'cd_match_alert_subscription', 'cd_push_subscription', 'cd_match',
        'is_notify_score', 'is_notify_comeback', 'is_notify_finished',
        'tx_culture', 'dt_created', 'is_active'
    ];
    v_expected_types text[] := ARRAY[
        'bigint', 'bigint', 'integer',
        'boolean', 'boolean', 'boolean',
        'character varying', 'timestamp with time zone', 'boolean'
    ];
    v_expected_nullable text[] := ARRAY[
        'NO', 'NO', 'NO',
        'NO', 'NO', 'NO',
        'NO', 'NO', 'NO'
    ];
    v_idx int;
    v_actual_col record;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'match_alert_subscription' AND table_schema = 'public'
    ) INTO v_table_exists;

    IF NOT v_table_exists THEN
        RAISE NOTICE 'match_alert_subscription does not exist, will be created';
        RETURN;
    END IF;

    -- Validate PK
    PERFORM pg_temp._cv_validate_pk('match_alert_subscription', 'cd_match_alert_subscription');

    -- Validate columns
    FOR v_idx IN 1..array_length(v_expected_columns, 1) LOOP
        SELECT c.data_type, c.is_nullable INTO v_actual_col
        FROM information_schema.columns c
        WHERE c.table_name = 'match_alert_subscription'
          AND c.table_schema = 'public'
          AND c.column_name = v_expected_columns[v_idx];

        IF NOT FOUND THEN
            RAISE EXCEPTION 'match_alert_subscription: missing column %', v_expected_columns[v_idx];
        END IF;
        IF v_actual_col.data_type <> v_expected_types[v_idx] THEN
            RAISE EXCEPTION 'match_alert_subscription: column % has type %, expected %',
                v_expected_columns[v_idx], v_actual_col.data_type, v_expected_types[v_idx];
        END IF;
        IF v_actual_col.is_nullable <> v_expected_nullable[v_idx] THEN
            RAISE EXCEPTION 'match_alert_subscription: column % has nullable=%, expected %',
                v_expected_columns[v_idx], v_actual_col.is_nullable, v_expected_nullable[v_idx];
        END IF;
    END LOOP;

    -- Validate tx_culture max length = 10
    PERFORM c.character_maximum_length
    FROM information_schema.columns c
    WHERE c.table_name = 'match_alert_subscription'
      AND c.table_schema = 'public'
      AND c.column_name = 'tx_culture'
      AND c.character_maximum_length = 10;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'match_alert_subscription.tx_culture: must have max_length = 10';
    END IF;

    -- Validate defaults
    PERFORM pg_temp._cv_validate_default('match_alert_subscription', 'is_notify_score', 'TRUE');
    PERFORM pg_temp._cv_validate_default('match_alert_subscription', 'is_notify_comeback', 'TRUE');
    PERFORM pg_temp._cv_validate_default('match_alert_subscription', 'is_notify_finished', 'TRUE');
    PERFORM pg_temp._cv_validate_default('match_alert_subscription', 'tx_culture', 'en');
    PERFORM pg_temp._cv_validate_default('match_alert_subscription', 'dt_created', 'NOW()');
    PERFORM pg_temp._cv_validate_default('match_alert_subscription', 'is_active', 'TRUE');

    -- Validate indexes
    PERFORM pg_temp._cv_validate_index('match_alert_subscription', 'ux_match_alert_subscription_sub_match',
        true, ARRAY['cd_push_subscription', 'cd_match'], 'is_active = true');
    PERFORM pg_temp._cv_validate_index('match_alert_subscription', 'ix_match_alert_subscription_match',
        false, ARRAY['cd_match'], 'is_active = true');

    RAISE NOTICE 'match_alert_subscription: structural validation OK';
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 2b: Create match_alert_subscription if not exists
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public."match_alert_subscription" (
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

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 2c: Create indexes if missing
-- ═════════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS "ux_match_alert_subscription_sub_match"
    ON public."match_alert_subscription" ("cd_push_subscription", "cd_match")
    WHERE "is_active" = TRUE;

CREATE INDEX IF NOT EXISTS "ix_match_alert_subscription_match"
    ON public."match_alert_subscription" ("cd_match")
    WHERE "is_active" = TRUE;

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 2d: Create FKs if missing (for existing tables without FKs)
-- ═════════════════════════════════════════════════════════════════════════════
SELECT pg_temp._cv_create_fk_if_missing('match_alert_subscription', 'cd_push_subscription',
    'push_subscription', 'cd_push_subscription', 'CASCADE');
SELECT pg_temp._cv_create_fk_if_missing('match_alert_subscription', 'cd_match',
    'match', 'cd_match', 'CASCADE');

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 2e: Validate FKs after creation
-- ═════════════════════════════════════════════════════════════════════════════
SELECT pg_temp._cv_validate_fk('match_alert_subscription', 'cd_push_subscription',
    'push_subscription', 'cd_push_subscription', 'CASCADE');
SELECT pg_temp._cv_validate_fk('match_alert_subscription', 'cd_match',
    'match', 'cd_match', 'CASCADE');

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 3: match_alert_delivery — structural validation
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    v_table_exists boolean;
    v_expected_columns text[] := ARRAY[
        'cd_match_alert_delivery', 'cd_push_subscription', 'cd_match',
        'cd_match_score_event', 'tx_event_key', 'tx_alert_type', 'tx_status',
        'nr_attempts', 'dt_next_attempt', 'dt_last_attempt', 'dt_sent', 'dt_created'
    ];
    v_expected_types text[] := ARRAY[
        'bigint', 'bigint', 'integer',
        'bigint', 'text', 'text', 'text',
        'integer', 'timestamp with time zone', 'timestamp with time zone',
        'timestamp with time zone', 'timestamp with time zone'
    ];
    v_expected_nullable text[] := ARRAY[
        'NO', 'NO', 'NO',
        'YES', 'NO', 'NO', 'NO',
        'NO', 'NO', 'YES',
        'YES', 'NO'
    ];
    v_idx int;
    v_actual_col record;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'match_alert_delivery' AND table_schema = 'public'
    ) INTO v_table_exists;

    IF NOT v_table_exists THEN
        RAISE NOTICE 'match_alert_delivery does not exist, will be created';
        RETURN;
    END IF;

    -- Validate PK
    PERFORM pg_temp._cv_validate_pk('match_alert_delivery', 'cd_match_alert_delivery');

    -- Validate columns
    FOR v_idx IN 1..array_length(v_expected_columns, 1) LOOP
        SELECT c.data_type, c.is_nullable INTO v_actual_col
        FROM information_schema.columns c
        WHERE c.table_name = 'match_alert_delivery'
          AND c.table_schema = 'public'
          AND c.column_name = v_expected_columns[v_idx];

        IF NOT FOUND THEN
            RAISE EXCEPTION 'match_alert_delivery: missing column %', v_expected_columns[v_idx];
        END IF;
        IF v_actual_col.data_type <> v_expected_types[v_idx] THEN
            RAISE EXCEPTION 'match_alert_delivery: column % has type %, expected %',
                v_expected_columns[v_idx], v_actual_col.data_type, v_expected_types[v_idx];
        END IF;
        IF v_actual_col.is_nullable <> v_expected_nullable[v_idx] THEN
            RAISE EXCEPTION 'match_alert_delivery: column % has nullable=%, expected %',
                v_expected_columns[v_idx], v_actual_col.is_nullable, v_expected_nullable[v_idx];
        END IF;
    END LOOP;

    -- Validate defaults
    PERFORM pg_temp._cv_validate_default('match_alert_delivery', 'tx_status', 'PENDING');
    PERFORM pg_temp._cv_validate_default('match_alert_delivery', 'nr_attempts', '0');
    PERFORM pg_temp._cv_validate_default('match_alert_delivery', 'dt_next_attempt', 'NOW()');
    PERFORM pg_temp._cv_validate_default('match_alert_delivery', 'dt_created', 'NOW()');

    -- Validate indexes
    PERFORM pg_temp._cv_validate_index('match_alert_delivery', 'ux_match_alert_delivery_sub_event_type',
        true, ARRAY['cd_push_subscription', 'tx_event_key', 'tx_alert_type'], NULL);
    PERFORM pg_temp._cv_validate_index('match_alert_delivery', 'ix_match_alert_delivery_eligible',
        false, ARRAY['dt_next_attempt'], 'tx_status = ''PENDING''');
    PERFORM pg_temp._cv_validate_index('match_alert_delivery', 'ix_match_alert_delivery_stuck',
        false, ARRAY['dt_last_attempt'], 'tx_status = ''PROCESSING''');

    RAISE NOTICE 'match_alert_delivery: structural validation OK';
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 3b: Create match_alert_delivery if not exists
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public."match_alert_delivery" (
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

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 3c: Create indexes if missing
-- ═════════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS "ux_match_alert_delivery_sub_event_type"
    ON public."match_alert_delivery" ("cd_push_subscription", "tx_event_key", "tx_alert_type");

CREATE INDEX IF NOT EXISTS "ix_match_alert_delivery_eligible"
    ON public."match_alert_delivery" ("dt_next_attempt")
    WHERE "tx_status" = 'PENDING';

CREATE INDEX IF NOT EXISTS "ix_match_alert_delivery_stuck"
    ON public."match_alert_delivery" ("dt_last_attempt")
    WHERE "tx_status" = 'PROCESSING';

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 3d: Create FKs if missing
-- ═════════════════════════════════════════════════════════════════════════════
SELECT pg_temp._cv_create_fk_if_missing('match_alert_delivery', 'cd_push_subscription',
    'push_subscription', 'cd_push_subscription', 'CASCADE');
SELECT pg_temp._cv_create_fk_if_missing('match_alert_delivery', 'cd_match',
    'match', 'cd_match', 'CASCADE');
SELECT pg_temp._cv_create_fk_if_missing('match_alert_delivery', 'cd_match_score_event',
    'match_score_event', 'cd_match_score_event', 'SET NULL');

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 3e: Validate FKs after creation
-- ═════════════════════════════════════════════════════════════════════════════
SELECT pg_temp._cv_validate_fk('match_alert_delivery', 'cd_push_subscription',
    'push_subscription', 'cd_push_subscription', 'CASCADE');
SELECT pg_temp._cv_validate_fk('match_alert_delivery', 'cd_match',
    'match', 'cd_match', 'CASCADE');
SELECT pg_temp._cv_validate_fk('match_alert_delivery', 'cd_match_score_event',
    'match_score_event', 'cd_match_score_event', 'SET NULL');

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 4: match_score_state — validate columns individually
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    v_col record;
BEGIN
    -- cd_last_undisputed_leader: integer, NULL
    SELECT c.data_type, c.is_nullable INTO v_col
    FROM information_schema.columns c
    WHERE c.table_name = 'match_score_state'
      AND c.table_schema = 'public'
      AND c.column_name = 'cd_last_undisputed_leader';

    IF FOUND THEN
        IF v_col.data_type <> 'integer' THEN
            RAISE EXCEPTION 'match_score_state.cd_last_undisputed_leader: type is %, expected integer', v_col.data_type;
        END IF;
        IF v_col.is_nullable <> 'YES' THEN
            RAISE EXCEPTION 'match_score_state.cd_last_undisputed_leader: nullable is %, expected YES', v_col.is_nullable;
        END IF;
        RAISE NOTICE 'match_score_state.cd_last_undisputed_leader: OK';
    ELSE
        RAISE NOTICE 'match_score_state.cd_last_undisputed_leader does not exist, will add';
    END IF;

    -- nr_last_goal_event_sequence: integer, NOT NULL, DEFAULT 0
    SELECT c.data_type, c.is_nullable, c.column_default INTO v_col
    FROM information_schema.columns c
    WHERE c.table_name = 'match_score_state'
      AND c.table_schema = 'public'
      AND c.column_name = 'nr_last_goal_event_sequence';

    IF FOUND THEN
        IF v_col.data_type <> 'integer' THEN
            RAISE EXCEPTION 'match_score_state.nr_last_goal_event_sequence: type is %, expected integer', v_col.data_type;
        END IF;
        IF v_col.is_nullable <> 'NO' THEN
            RAISE EXCEPTION 'match_score_state.nr_last_goal_event_sequence: nullable is %, expected NO', v_col.is_nullable;
        END IF;
        IF pg_temp._cv_normalize_default(v_col.column_default) <> '0' THEN
            RAISE EXCEPTION 'match_score_state.nr_last_goal_event_sequence: default is %, expected 0', v_col.column_default;
        END IF;
        RAISE NOTICE 'match_score_state.nr_last_goal_event_sequence: OK';
    ELSE
        RAISE NOTICE 'match_score_state.nr_last_goal_event_sequence does not exist, will add';
    END IF;
END $$;

ALTER TABLE public."match_score_state"
    ADD COLUMN IF NOT EXISTS "cd_last_undisputed_leader" integer NULL,
    ADD COLUMN IF NOT EXISTS "nr_last_goal_event_sequence" integer NOT NULL DEFAULT 0;

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 5: Register migration — validate ProductVersion before insert
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    v_existing_version text;
BEGIN
    SELECT "ProductVersion" INTO v_existing_version
    FROM public."__EFMigrationsHistory"
    WHERE "MigrationId" = '20260808000000_AddPushNotificationTables';

    IF NOT FOUND THEN
        INSERT INTO public."__EFMigrationsHistory" ("MigrationId", "ProductVersion")
        VALUES ('20260808000000_AddPushNotificationTables', '8.0.8');
        RAISE NOTICE 'Migration 20260808000000_AddPushNotificationTables registered (version 8.0.8)';
    ELSIF v_existing_version = '8.0.8' THEN
        RAISE NOTICE 'Migration 20260808000000_AddPushNotificationTables already registered with correct version 8.0.8';
    ELSE
        RAISE EXCEPTION 'Migration 20260808000000_AddPushNotificationTables exists with version %, expected 8.0.8',
            v_existing_version;
    END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Cleanup: pg_temp functions auto-drop when session ends. No persistent objects left.
-- ═════════════════════════════════════════════════════════════════════════════

COMMIT;
