-- Auditoria SQL para Match #397 (PENGUUSDT vs CHIPUSDT)
-- Banco esperado: PostgreSQL
-- Objetivo: provar se houve erro de liquidacao ou apenas erro de exibicao.
--
-- Observacao importante do schema atual:
-- 1) Nao existe coluna nr_refund_amount em "bet".
-- 2) O worker grava o reembolso em bet.nr_payout_amount para casos NO_WINNER/no-contest.
-- 3) A tabela "ledger" registra o debito da aposta via reference_id = cd_bet.
-- 4) O credito ao saldo do usuario nao e escrito no settlement; ele ocorre depois no claim
--    via tx_type = 'CLAIM', sem reference_id por bet.
-- Portanto:
-- - "valor_real_liquidado" por bet = bet.nr_payout_amount
-- - "valor_real_creditado_ledger" e auditavel com limitacao quando um CLAIM cobre varias bets

-- =========================================================
-- 0) INSPECAO DE SCHEMA REAL
-- =========================================================

SELECT
    c.table_name,
    c.column_name,
    c.data_type,
    c.is_nullable
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN ('match', 'bet', 'ledger', 'user', 'team', 'currency')
ORDER BY c.table_name, c.ordinal_position;

-- =========================================================
-- 1) MATCH #397: prova do placar, simbolos, winner, motivo e pools
-- =========================================================

WITH bet_pool AS (
    SELECT
        b.cd_match,
        b.cd_team,
        SUM(b.nr_amount) AS total_apostado_time,
        COUNT(*) AS qtd_apostas_time,
        COUNT(DISTINCT b.cd_user) AS qtd_carteiras_time,
        SUM(COALESCE(b.nr_payout_amount, 0)) AS total_distribuido_time
    FROM bet b
    WHERE b.cd_match = 397
    GROUP BY b.cd_match, b.cd_team
)
SELECT
    m.cd_match AS match_id,
    ca.tx_symbol AS team_a_symbol,
    cb.tx_symbol AS team_b_symbol,
    m.nr_score_a AS score_a,
    m.nr_score_b AS score_b,
    CONCAT(ca.tx_symbol, ' ', m.nr_score_a, ' x ', m.nr_score_b, ' ', cb.tx_symbol) AS placar_final,
    m.cd_winner_team AS winner_team_id,
    cw.tx_symbol AS winner_team_symbol,
    m.tx_end_reason_code AS settlement_reason,
    m.tx_end_reason_detail AS settlement_reason_detail,
    m.in_status AS match_status,
    m.dt_start_time,
    m.dt_betting_close,
    m.dt_end_time,
    COALESCE(pa.total_apostado_time, 0) AS total_team_a,
    COALESCE(pb.total_apostado_time, 0) AS total_team_b,
    COALESCE(pa.qtd_apostas_time, 0) AS bets_team_a,
    COALESCE(pb.qtd_apostas_time, 0) AS bets_team_b,
    COALESCE(pa.qtd_carteiras_time, 0) AS wallets_team_a,
    COALESCE(pb.qtd_carteiras_time, 0) AS wallets_team_b,
    COALESCE(pa.total_apostado_time, 0) + COALESCE(pb.total_apostado_time, 0) AS total_pool,
    COALESCE(pa.total_distribuido_time, 0) + COALESCE(pb.total_distribuido_time, 0) AS total_distribuido,
    CASE
        WHEN m.nr_score_a = m.nr_score_b
          OR m.cd_winner_team IS NULL
          OR m.tx_end_reason_code = 'NO_WINNER'
        THEN 'SIM'
        ELSE 'NAO'
    END AS deveria_ser_reembolso_integral
FROM match m
JOIN team ta ON ta.cd_team = m.cd_team_a
JOIN currency ca ON ca.cd_currency = ta.cd_currency
JOIN team tb ON tb.cd_team = m.cd_team_b
JOIN currency cb ON cb.cd_currency = tb.cd_currency
LEFT JOIN team tw ON tw.cd_team = m.cd_winner_team
LEFT JOIN currency cw ON cw.cd_currency = tw.cd_currency
LEFT JOIN bet_pool pa ON pa.cd_match = m.cd_match AND pa.cd_team = m.cd_team_a
LEFT JOIN bet_pool pb ON pb.cd_match = m.cd_match AND pb.cd_team = m.cd_team_b
WHERE m.cd_match = 397;

-- =========================================================
-- 2) TODAS AS BETS DA PARTIDA
-- =========================================================

SELECT
    b.cd_match AS match_id,
    b.cd_bet AS bet_id,
    b.cd_user AS user_id,
    u.tx_wallet AS wallet,
    b.cd_team AS chosen_team_id,
    ct.tx_symbol AS chosen_team_symbol,
    b.nr_amount AS apostado,
    b.nr_payout_amount AS nr_payout_amount,
    b.is_winner,
    b.is_claimed,
    b.dt_bet_time AS dt_created_at,
    b.dt_settled_at,
    m.nr_score_a AS score_a,
    m.nr_score_b AS score_b,
    m.cd_winner_team AS winner_team_id,
    m.tx_end_reason_code AS settlement_reason,
    CASE
        WHEN m.nr_score_a = m.nr_score_b
          OR m.cd_winner_team IS NULL
          OR m.tx_end_reason_code = 'NO_WINNER'
        THEN b.nr_amount
        ELSE COALESCE(b.nr_payout_amount, 0)
    END AS valor_esperado,
    COALESCE(b.nr_payout_amount, 0) AS valor_real_liquidado,
    COALESCE(b.nr_payout_amount, 0) -
    CASE
        WHEN m.nr_score_a = m.nr_score_b
          OR m.cd_winner_team IS NULL
          OR m.tx_end_reason_code = 'NO_WINNER'
        THEN b.nr_amount
        ELSE COALESCE(b.nr_payout_amount, 0)
    END AS diferenca_liquidacao,
    CASE
        WHEN COALESCE(b.nr_payout_amount, 0) <>
             CASE
                 WHEN m.nr_score_a = m.nr_score_b
                   OR m.cd_winner_team IS NULL
                   OR m.tx_end_reason_code = 'NO_WINNER'
                 THEN b.nr_amount
                 ELSE COALESCE(b.nr_payout_amount, 0)
             END
        THEN 'BUG'
        ELSE 'OK'
    END AS auditoria_status
FROM bet b
JOIN match m ON m.cd_match = b.cd_match
JOIN "user" u ON u.cd_user = b.cd_user
JOIN team t ON t.cd_team = b.cd_team
JOIN currency ct ON ct.cd_currency = t.cd_currency
WHERE b.cd_match = 397
ORDER BY b.dt_bet_time, b.cd_bet;

-- =========================================================
-- 3) LEDGER FINANCEIRO RELACIONADO
-- =========================================================
-- Debito da aposta: reference_id = bet.cd_bet
-- Credito de claim: tx_type = 'CLAIM', mas sem reference_id por bet

WITH match_bets AS (
    SELECT
        b.cd_bet,
        b.cd_match,
        b.cd_user,
        b.nr_amount,
        b.nr_payout_amount,
        b.dt_bet_time,
        b.dt_settled_at
    FROM bet b
    WHERE b.cd_match = 397
),
bet_ledger AS (
    SELECT
        mb.cd_bet,
        l.id AS ledger_id,
        l.cd_user,
        l.tx_type,
        l.nr_amount,
        l.nr_balance_before,
        l.nr_balance_after,
        l.dt_created,
        l.reference_id,
        l.tx_description
    FROM match_bets mb
    LEFT JOIN ledger l
        ON l.reference_id = mb.cd_bet
),
claim_ledger AS (
    SELECT
        mb.cd_bet,
        l.id AS ledger_id,
        l.cd_user,
        l.tx_type,
        l.nr_amount,
        l.nr_balance_before,
        l.nr_balance_after,
        l.dt_created,
        l.reference_id,
        l.tx_description
    FROM match_bets mb
    LEFT JOIN ledger l
        ON l.cd_user = mb.cd_user
       AND l.tx_type = 'CLAIM'
       AND l.dt_created >= COALESCE(mb.dt_settled_at, mb.dt_bet_time)
)
SELECT
    mb.cd_match AS match_id,
    mb.cd_bet AS bet_id,
    u.tx_wallet AS wallet,
    bl.ledger_id AS debit_ledger_id,
    bl.tx_type AS debit_type,
    bl.nr_amount AS debit_amount,
    bl.dt_created AS debit_created_at,
    bl.tx_description AS debit_description,
    cl.ledger_id AS claim_ledger_id,
    cl.tx_type AS claim_type,
    cl.nr_amount AS claim_amount,
    cl.dt_created AS claim_created_at,
    cl.tx_description AS claim_description
FROM match_bets mb
JOIN "user" u ON u.cd_user = mb.cd_user
LEFT JOIN bet_ledger bl ON bl.cd_bet = mb.cd_bet
LEFT JOIN claim_ledger cl ON cl.cd_bet = mb.cd_bet
ORDER BY mb.dt_bet_time, mb.cd_bet, cl.dt_created;

-- =========================================================
-- 4) SALDO LIQUIDO POR USUARIO PARA A PARTIDA
-- =========================================================

WITH match_bets AS (
    SELECT
        b.cd_bet,
        b.cd_match,
        b.cd_user,
        b.nr_amount,
        COALESCE(b.nr_payout_amount, 0) AS nr_payout_amount,
        b.dt_settled_at
    FROM bet b
    WHERE b.cd_match = 397
),
user_settlement_anchor AS (
    SELECT
        mb.cd_user,
        MIN(mb.dt_settled_at) AS first_settled_at
    FROM match_bets mb
    GROUP BY mb.cd_user
),
debits AS (
    SELECT
        mb.cd_user,
        SUM(l.nr_amount) AS total_debito_bet
    FROM match_bets mb
    LEFT JOIN ledger l
        ON l.reference_id = mb.cd_bet
       AND l.tx_type IN ('BET', 'BET_ONCHAIN')
    GROUP BY mb.cd_user
),
claims_after_settlement AS (
    SELECT
        usa.cd_user,
        SUM(l.nr_amount) AS total_claims_posteriores
    FROM user_settlement_anchor usa
    LEFT JOIN ledger l
        ON l.cd_user = usa.cd_user
       AND l.tx_type = 'CLAIM'
       AND l.dt_created >= usa.first_settled_at
    GROUP BY usa.cd_user
),
bet_totals AS (
    SELECT
        mb.cd_user,
        SUM(mb.nr_amount) AS total_apostado,
        SUM(mb.nr_payout_amount) AS total_liquidado_em_bet
    FROM match_bets mb
    GROUP BY mb.cd_user
)
SELECT
    bt.cd_user AS user_id,
    u.tx_wallet AS wallet,
    bt.total_apostado,
    bt.total_liquidado_em_bet,
    COALESCE(d.total_debito_bet, 0) AS ledger_total_bet,
    COALESCE(c.total_claims_posteriores, 0) AS ledger_total_claim_pos_settlement,
    COALESCE(d.total_debito_bet, 0) + COALESCE(c.total_claims_posteriores, 0) AS ledger_liquido
FROM bet_totals bt
JOIN "user" u ON u.cd_user = bt.cd_user
LEFT JOIN debits d ON d.cd_user = bt.cd_user
LEFT JOIN claims_after_settlement c ON c.cd_user = bt.cd_user
ORDER BY bt.cd_user;

-- =========================================================
-- 5) AUDITORIA CONSOLIDADA: refund esperado vs real
-- =========================================================

WITH match_ctx AS (
    SELECT
        m.cd_match,
        m.cd_team_a,
        m.cd_team_b,
        ca.tx_symbol AS team_a_symbol,
        cb.tx_symbol AS team_b_symbol,
        m.nr_score_a,
        m.nr_score_b,
        m.cd_winner_team,
        m.tx_end_reason_code,
        m.in_status
    FROM match m
    JOIN team ta ON ta.cd_team = m.cd_team_a
    JOIN currency ca ON ca.cd_currency = ta.cd_currency
    JOIN team tb ON tb.cd_team = m.cd_team_b
    JOIN currency cb ON cb.cd_currency = tb.cd_currency
    WHERE m.cd_match = 397
),
bet_debit AS (
    SELECT
        l.reference_id AS bet_id,
        SUM(l.nr_amount) AS ledger_debit_amount
    FROM ledger l
    WHERE l.tx_type IN ('BET', 'BET_ONCHAIN')
    GROUP BY l.reference_id
),
bet_claim_window AS (
    SELECT
        b.cd_bet AS bet_id,
        SUM(CASE WHEN l.tx_type = 'CLAIM' THEN l.nr_amount ELSE 0 END) AS claim_amount_after_settlement
    FROM bet b
    LEFT JOIN ledger l
        ON l.cd_user = b.cd_user
       AND l.tx_type = 'CLAIM'
       AND l.dt_created >= b.dt_settled_at
    WHERE b.cd_match = 397
    GROUP BY b.cd_bet
)
SELECT
    mc.cd_match AS match_id,
    b.cd_bet AS bet_id,
    u.tx_wallet AS wallet,
    b.nr_amount AS apostado,
    CONCAT(mc.team_a_symbol, ' ', mc.nr_score_a, ' x ', mc.nr_score_b, ' ', mc.team_b_symbol) AS placar_final,
    mc.tx_end_reason_code AS motivo,
    CASE
        WHEN mc.nr_score_a = mc.nr_score_b
          OR mc.cd_winner_team IS NULL
          OR mc.tx_end_reason_code = 'NO_WINNER'
        THEN b.nr_amount
        ELSE COALESCE(b.nr_payout_amount, 0)
    END AS valor_esperado,
    COALESCE(b.nr_payout_amount, 0) AS valor_real,
    COALESCE(b.nr_payout_amount, 0) -
    CASE
        WHEN mc.nr_score_a = mc.nr_score_b
          OR mc.cd_winner_team IS NULL
          OR mc.tx_end_reason_code = 'NO_WINNER'
        THEN b.nr_amount
        ELSE COALESCE(b.nr_payout_amount, 0)
    END AS diferenca,
    CASE
        WHEN COALESCE(b.nr_payout_amount, 0) <>
             CASE
                 WHEN mc.nr_score_a = mc.nr_score_b
                   OR mc.cd_winner_team IS NULL
                   OR mc.tx_end_reason_code = 'NO_WINNER'
                 THEN b.nr_amount
                 ELSE COALESCE(b.nr_payout_amount, 0)
             END
        THEN 'BUG'
        ELSE 'OK'
    END AS status_bug,
    b.is_winner,
    b.is_claimed,
    bd.ledger_debit_amount,
    bcw.claim_amount_after_settlement,
    CASE
        WHEN (mc.nr_score_a = mc.nr_score_b
           OR mc.cd_winner_team IS NULL
           OR mc.tx_end_reason_code = 'NO_WINNER')
         AND COALESCE(b.is_winner::int, -1) <> -1
        THEN 'BUG_IS_WINNER_EM_REEMBOLSO'
        WHEN (mc.nr_score_a = mc.nr_score_b
           OR mc.cd_winner_team IS NULL
           OR mc.tx_end_reason_code = 'NO_WINNER')
         AND COALESCE(b.nr_payout_amount, 0) <> b.nr_amount
        THEN 'BUG_LIQUIDACAO_BET'
        WHEN bd.ledger_debit_amount IS NULL
        THEN 'BUG_LEDGER_DEBIT_AUSENTE'
        ELSE 'OK'
    END AS diagnostico
FROM bet b
JOIN match_ctx mc ON mc.cd_match = b.cd_match
JOIN "user" u ON u.cd_user = b.cd_user
LEFT JOIN bet_debit bd ON bd.bet_id = b.cd_bet
LEFT JOIN bet_claim_window bcw ON bcw.bet_id = b.cd_bet
WHERE b.cd_match = 397
ORDER BY b.dt_bet_time, b.cd_bet;
