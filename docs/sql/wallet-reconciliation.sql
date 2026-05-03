-- Wallet reconciliation queries for CriptoVersus Off-chain Custody.
-- These queries avoid join multiplication between bet and user_team_position.

-- 1) Global reconciliation versus custody balance.
-- Replace 1.2 with the real custody SOL balance before running.
with user_balances as (
    select coalesce(sum(u.nr_balance), 0) as total_system_balance
    from "user" u
),
position_capital as (
    select
        coalesce(sum(case when p.in_status <> 2 then p.nr_current_capital else 0 end), 0) as total_open_position_capital,
        coalesce(sum(case when p.in_status <> 2 then p.nr_principal_allocated else 0 end), 0) as total_open_position_principal
    from user_team_position p
),
payouts as (
    select
        coalesce(sum(case
            when b.dt_settled_at is not null
             and not b.is_claimed
             and coalesce(b.nr_payout_amount, 0) > 0
            then coalesce(b.nr_payout_amount, 0)
            else 0 end), 0) as naive_unclaimed_payouts,

        coalesce(sum(case
            when b.dt_settled_at is not null
             and not b.is_claimed
             and coalesce(b.nr_payout_amount, 0) > 0
             and (
                 b.cd_position is null
                 or p.in_status = 2
             )
            then coalesce(b.nr_payout_amount, 0)
            else 0 end), 0) as correct_claimable_payouts,

        coalesce(sum(case
            when b.dt_settled_at is not null
             and not b.is_claimed
             and coalesce(b.nr_payout_amount, 0) > 0
             and b.cd_position is not null
             and p.in_status <> 2
            then coalesce(b.nr_payout_amount, 0)
            else 0 end), 0) as double_counted_compounded_payouts
    from bet b
    left join user_team_position p on p.cd_position = b.cd_position
)
select
    1.2::numeric(18,8) as custody_real_balance,
    ub.total_system_balance,
    pc.total_open_position_capital,
    pc.total_open_position_principal,
    py.naive_unclaimed_payouts,
    py.correct_claimable_payouts,
    py.double_counted_compounded_payouts,
    (ub.total_system_balance + pc.total_open_position_capital + py.naive_unclaimed_payouts) as naive_total_obligation,
    (ub.total_system_balance + pc.total_open_position_capital + py.correct_claimable_payouts) as corrected_total_obligation,
    (ub.total_system_balance + pc.total_open_position_capital + py.naive_unclaimed_payouts - 1.2::numeric(18,8)) as naive_gap_vs_custody,
    (ub.total_system_balance + pc.total_open_position_capital + py.correct_claimable_payouts - 1.2::numeric(18,8)) as corrected_gap_vs_custody
from user_balances ub
cross join position_capital pc
cross join payouts py;

-- 2) Per-user reconciliation without join multiplication.
with bet_agg as (
    select
        b.cd_user,
        coalesce(sum(b.nr_amount), 0) as total_apostado_historico,
        coalesce(sum(case when b.dt_settled_at is null then b.nr_amount else 0 end), 0) as apostas_nao_liquidadas,
        coalesce(sum(case
            when b.dt_settled_at is not null
             and not b.is_claimed
             and coalesce(b.nr_payout_amount, 0) > 0
            then coalesce(b.nr_payout_amount, 0)
            else 0 end), 0) as naive_unclaimed_payouts,
        coalesce(sum(case
            when b.dt_settled_at is not null
             and not b.is_claimed
             and coalesce(b.nr_payout_amount, 0) > 0
             and (
                 b.cd_position is null
                 or p.in_status = 2
             )
            then coalesce(b.nr_payout_amount, 0)
            else 0 end), 0) as correct_claimable_payouts,
        coalesce(sum(case
            when b.dt_settled_at is not null
             and not b.is_claimed
             and coalesce(b.nr_payout_amount, 0) > 0
             and b.cd_position is not null
             and p.in_status <> 2
            then coalesce(b.nr_payout_amount, 0)
            else 0 end), 0) as double_counted_compounded_payouts,
        count(b.cd_bet) as qtd_bets
    from bet b
    left join user_team_position p on p.cd_position = b.cd_position
    group by b.cd_user
),
position_agg as (
    select
        p.cd_user,
        coalesce(sum(case when p.in_status <> 2 then p.nr_principal_allocated else 0 end), 0) as open_position_principal,
        coalesce(sum(case when p.in_status <> 2 then p.nr_current_capital else 0 end), 0) as open_position_capital,
        count(*) filter (where p.in_status <> 2) as qtd_posicoes_abertas
    from user_team_position p
    group by p.cd_user
)
select
    u.cd_user,
    u.tx_wallet,
    u.nr_balance as system_balance,
    coalesce(pa.open_position_capital, 0) as open_position_capital,
    coalesce(pa.open_position_principal, 0) as open_position_principal,
    coalesce(ba.naive_unclaimed_payouts, 0) as naive_unclaimed_payouts,
    coalesce(ba.correct_claimable_payouts, 0) as correct_claimable_payouts,
    coalesce(ba.double_counted_compounded_payouts, 0) as double_counted_compounded_payouts,
    (u.nr_balance + coalesce(pa.open_position_capital, 0) + coalesce(ba.naive_unclaimed_payouts, 0)) as naive_user_obligation,
    (u.nr_balance + coalesce(pa.open_position_capital, 0) + coalesce(ba.correct_claimable_payouts, 0)) as corrected_user_obligation,
    coalesce(ba.total_apostado_historico, 0) as total_apostado_historico,
    coalesce(ba.apostas_nao_liquidadas, 0) as apostas_nao_liquidadas,
    coalesce(pa.qtd_posicoes_abertas, 0) as qtd_posicoes_abertas,
    coalesce(ba.qtd_bets, 0) as qtd_bets
from "user" u
left join bet_agg ba on ba.cd_user = u.cd_user
left join position_agg pa on pa.cd_user = u.cd_user
where u.nr_balance <> 0
   or coalesce(pa.open_position_capital, 0) <> 0
   or coalesce(ba.naive_unclaimed_payouts, 0) <> 0
order by double_counted_compounded_payouts desc, corrected_user_obligation desc, u.cd_user;

-- 3) Settled bets that are still attached to active positions and should not
--    appear as available returns.
select
    b.cd_bet,
    b.cd_user,
    u.tx_wallet,
    b.cd_match,
    b.cd_team,
    b.cd_position,
    p.in_status as position_status,
    p.nr_principal_allocated,
    p.nr_current_capital,
    b.nr_amount as bet_amount,
    b.nr_payout_amount,
    b.dt_bet_time,
    b.dt_settled_at,
    b.is_claimed
from bet b
join "user" u on u.cd_user = b.cd_user
left join user_team_position p on p.cd_position = b.cd_position
where b.dt_settled_at is not null
  and not b.is_claimed
  and coalesce(b.nr_payout_amount, 0) > 0
  and b.cd_position is not null
  and p.in_status <> 2
order by b.cd_user, b.cd_position, b.cd_bet;

-- 4) One-wallet drill-down. Replace the wallet below as needed.
with bet_agg as (
    select
        b.cd_user,
        coalesce(sum(b.nr_amount), 0) as total_apostado_historico,
        coalesce(sum(case when b.dt_settled_at is null then b.nr_amount else 0 end), 0) as apostas_nao_liquidadas,
        coalesce(sum(case
            when b.dt_settled_at is not null
             and not b.is_claimed
             and coalesce(b.nr_payout_amount, 0) > 0
            then coalesce(b.nr_payout_amount, 0)
            else 0 end), 0) as naive_unclaimed_payouts,
        coalesce(sum(case
            when b.dt_settled_at is not null
             and not b.is_claimed
             and coalesce(b.nr_payout_amount, 0) > 0
             and (
                 b.cd_position is null
                 or p.in_status = 2
             )
            then coalesce(b.nr_payout_amount, 0)
            else 0 end), 0) as correct_claimable_payouts,
        coalesce(sum(case
            when b.dt_settled_at is not null
             and not b.is_claimed
             and coalesce(b.nr_payout_amount, 0) > 0
             and b.cd_position is not null
             and p.in_status <> 2
            then coalesce(b.nr_payout_amount, 0)
            else 0 end), 0) as double_counted_compounded_payouts
    from bet b
    left join user_team_position p on p.cd_position = b.cd_position
    group by b.cd_user
),
position_agg as (
    select
        p.cd_user,
        coalesce(sum(case when p.in_status <> 2 then p.nr_principal_allocated else 0 end), 0) as open_position_principal,
        coalesce(sum(case when p.in_status <> 2 then p.nr_current_capital else 0 end), 0) as open_position_capital
    from user_team_position p
    group by p.cd_user
)
select
    u.cd_user,
    u.tx_wallet,
    u.nr_balance as system_balance,
    u.nr_total_claimed,
    u.nr_total_withdrawn,
    coalesce(ba.total_apostado_historico, 0) as total_apostado_historico,
    coalesce(ba.apostas_nao_liquidadas, 0) as apostas_nao_liquidadas,
    coalesce(ba.naive_unclaimed_payouts, 0) as naive_unclaimed_payouts,
    coalesce(ba.correct_claimable_payouts, 0) as correct_claimable_payouts,
    coalesce(ba.double_counted_compounded_payouts, 0) as double_counted_compounded_payouts,
    coalesce(pa.open_position_principal, 0) as open_positions_principal,
    coalesce(pa.open_position_capital, 0) as open_positions_current_capital
from "user" u
left join bet_agg ba on ba.cd_user = u.cd_user
left join position_agg pa on pa.cd_user = u.cd_user
where u.tx_wallet = '2ahAKQUE3xTHnVTb3cNESq8mjtqBDC59BnKvt3QVi6cG';
