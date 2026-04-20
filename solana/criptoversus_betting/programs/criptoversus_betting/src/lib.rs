use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};

declare_id!("4Ck537z1KEw1Azn9EHMvrW6xUhXGCUhDpSBJh6j5xjSX");

#[program]
pub mod criptoversus_betting {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn create_match(
        ctx: Context<CreateMatch>,
        match_id: u64,
        team_a_id: u8,
        team_b_id: u8,
        betting_close_ts: i64,
    ) -> Result<()> {
        require!(team_a_id != team_b_id, BettingError::InvalidTeam);

        let config = &ctx.accounts.config;
        require_keys_eq!(
            config.authority,
            ctx.accounts.authority.key(),
            BettingError::Unauthorized
        );

        let match_account = &mut ctx.accounts.match_account;
        match_account.match_id = match_id;
        match_account.team_a_id = team_a_id;
        match_account.team_b_id = team_b_id;
        match_account.betting_close_ts = betting_close_ts;
        match_account.status = MatchStatus::Open as u8;
        match_account.winning_team_id = 0;
        match_account.total_team_a = 0;
        match_account.total_team_b = 0;
        match_account.total_pool = 0;
        match_account.bet_count = 0;
        match_account.bump = ctx.bumps.match_account;
        match_account.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn place_bet(
        ctx: Context<PlaceBet>,
        match_id: u64,
        team_id: u8,
        amount_lamports: u64,
    ) -> Result<()> {
        require!(amount_lamports > 0, BettingError::InvalidAmount);

        let clock = Clock::get()?;
        let match_account = &mut ctx.accounts.match_account;

        require_eq!(match_account.match_id, match_id, BettingError::InvalidMatch);
        require_eq!(match_account.status, MatchStatus::Open as u8, BettingError::BettingClosed);
        require!(
            clock.unix_timestamp <= match_account.betting_close_ts,
            BettingError::BettingClosed
        );
        require!(
            team_id == match_account.team_a_id || team_id == match_account.team_b_id,
            BettingError::InvalidTeam
        );

        invoke(
            &system_instruction::transfer(
                &ctx.accounts.bettor.key(),
                &ctx.accounts.vault.key(),
                amount_lamports,
            ),
            &[
                ctx.accounts.bettor.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        if team_id == match_account.team_a_id {
            match_account.total_team_a = match_account
                .total_team_a
                .checked_add(amount_lamports)
                .ok_or(BettingError::MathOverflow)?;
        } else {
            match_account.total_team_b = match_account
                .total_team_b
                .checked_add(amount_lamports)
                .ok_or(BettingError::MathOverflow)?;
        }

        match_account.total_pool = match_account
            .total_pool
            .checked_add(amount_lamports)
            .ok_or(BettingError::MathOverflow)?;
        match_account.bet_count = match_account
            .bet_count
            .checked_add(1)
            .ok_or(BettingError::MathOverflow)?;

        let bet = &mut ctx.accounts.bet;
        bet.match_account = match_account.key();
        bet.bettor = ctx.accounts.bettor.key();
        bet.team_id = team_id;
        bet.amount_lamports = amount_lamports;
        bet.claimed = false;
        bet.bump = ctx.bumps.bet;

        Ok(())
    }

    pub fn settle_match(ctx: Context<SettleMatch>, winning_team_id: u8) -> Result<()> {
        let config = &ctx.accounts.config;
        require_keys_eq!(
            config.authority,
            ctx.accounts.authority.key(),
            BettingError::Unauthorized
        );

        let match_account = &mut ctx.accounts.match_account;
        require_eq!(match_account.status, MatchStatus::Open as u8, BettingError::AlreadySettled);
        require!(
            winning_team_id == match_account.team_a_id || winning_team_id == match_account.team_b_id,
            BettingError::InvalidTeam
        );

        match_account.status = MatchStatus::Settled as u8;
        match_account.winning_team_id = winning_team_id;
        Ok(())
    }

    pub fn claim_payout(ctx: Context<ClaimPayout>) -> Result<()> {
        let match_account = &ctx.accounts.match_account;
        let bet = &mut ctx.accounts.bet;

        require_eq!(match_account.status, MatchStatus::Settled as u8, BettingError::NotSettled);
        require!(!bet.claimed, BettingError::AlreadyClaimed);
        require_keys_eq!(bet.bettor, ctx.accounts.bettor.key(), BettingError::Unauthorized);

        let winning_total = if match_account.winning_team_id == match_account.team_a_id {
            match_account.total_team_a
        } else {
            match_account.total_team_b
        };

        require!(winning_total > 0, BettingError::NoWinningPool);

        let payout_lamports = if bet.team_id == match_account.winning_team_id {
            ((bet.amount_lamports as u128)
                .checked_mul(match_account.total_pool as u128)
                .ok_or(BettingError::MathOverflow)?
                / winning_total as u128) as u64
        } else {
            0
        };

        bet.claimed = true;

        if payout_lamports > 0 {
            let vault_info = ctx.accounts.vault.to_account_info();
            let bettor_info = ctx.accounts.bettor.to_account_info();

            **vault_info.try_borrow_mut_lamports()? = vault_info
                .lamports()
                .checked_sub(payout_lamports)
                .ok_or(BettingError::InsufficientVaultBalance)?;

            **bettor_info.try_borrow_mut_lamports()? = bettor_info
                .lamports()
                .checked_add(payout_lamports)
                .ok_or(BettingError::MathOverflow)?;
        }

        Ok(())
    }

    pub fn create_position(
        ctx: Context<CreatePosition>,
        team_id: u8,
        amount_lamports: u64,
    ) -> Result<()> {
        require!(team_id > 0, BettingError::InvalidTeam);
        require!(amount_lamports > 0, BettingError::InvalidAmount);

        invoke(
            &system_instruction::transfer(
                &ctx.accounts.owner.key(),
                &ctx.accounts.position_vault.key(),
                amount_lamports,
            ),
            &[
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.position_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        let position = &mut ctx.accounts.position;
        position.owner = ctx.accounts.owner.key();
        position.team_id = team_id;
        position.principal_lamports = amount_lamports;
        position.current_lamports = amount_lamports;
        position.locked_lamports = 0;
        position.status = PositionStatus::Active as u8;
        position.bump = ctx.bumps.position;
        position.vault_bump = ctx.bumps.position_vault;

        Ok(())
    }

    pub fn deposit_position(ctx: Context<DepositPosition>, amount_lamports: u64) -> Result<()> {
        require!(amount_lamports > 0, BettingError::InvalidAmount);

        let position = &mut ctx.accounts.position;
        require_keys_eq!(position.owner, ctx.accounts.owner.key(), BettingError::Unauthorized);
        require!(
            position.status == PositionStatus::Active as u8
                || position.status == PositionStatus::ClosingRequested as u8,
            BettingError::PositionClosed
        );

        invoke(
            &system_instruction::transfer(
                &ctx.accounts.owner.key(),
                &ctx.accounts.position_vault.key(),
                amount_lamports,
            ),
            &[
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.position_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        position.principal_lamports = position
            .principal_lamports
            .checked_add(amount_lamports)
            .ok_or(BettingError::MathOverflow)?;
        position.current_lamports = position
            .current_lamports
            .checked_add(amount_lamports)
            .ok_or(BettingError::MathOverflow)?;
        position.status = PositionStatus::Active as u8;

        Ok(())
    }

    pub fn request_close_position(ctx: Context<RequestClosePosition>) -> Result<()> {
        let position = &mut ctx.accounts.position;
        require_keys_eq!(position.owner, ctx.accounts.owner.key(), BettingError::Unauthorized);
        require!(position.status != PositionStatus::Closed as u8, BettingError::PositionClosed);

        position.status = PositionStatus::ClosingRequested as u8;
        Ok(())
    }

    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        let position = &mut ctx.accounts.position;
        require_keys_eq!(position.owner, ctx.accounts.owner.key(), BettingError::Unauthorized);
        require_eq!(position.locked_lamports, 0, BettingError::PositionLocked);

        let amount = ctx.accounts.position_vault.to_account_info().lamports();
        move_lamports(
            &ctx.accounts.position_vault.to_account_info(),
            &ctx.accounts.owner.to_account_info(),
            amount,
        )?;

        position.current_lamports = 0;
        position.locked_lamports = 0;
        position.status = PositionStatus::Closed as u8;

        Ok(())
    }

    pub fn enter_position_cycle(ctx: Context<EnterPositionCycle>) -> Result<()> {
        let config = &ctx.accounts.config;
        require_keys_eq!(
            config.authority,
            ctx.accounts.authority.key(),
            BettingError::Unauthorized
        );

        let match_account = &mut ctx.accounts.match_account;
        let position = &mut ctx.accounts.position;

        require_eq!(match_account.status, MatchStatus::Open as u8, BettingError::BettingClosed);
        require!(
            position.status == PositionStatus::Active as u8,
            BettingError::PositionClosed
        );
        require!(
            position.team_id == match_account.team_a_id || position.team_id == match_account.team_b_id,
            BettingError::InvalidTeam
        );
        require!(position.current_lamports > 0, BettingError::InvalidAmount);
        require_eq!(position.locked_lamports, 0, BettingError::PositionLocked);

        let amount = position.current_lamports;

        if position.team_id == match_account.team_a_id {
            match_account.total_team_a = match_account
                .total_team_a
                .checked_add(amount)
                .ok_or(BettingError::MathOverflow)?;
        } else {
            match_account.total_team_b = match_account
                .total_team_b
                .checked_add(amount)
                .ok_or(BettingError::MathOverflow)?;
        }

        match_account.bet_count = match_account
            .bet_count
            .checked_add(1)
            .ok_or(BettingError::MathOverflow)?;
        position.locked_lamports = amount;

        let entry = &mut ctx.accounts.cycle_entry;
        entry.match_account = match_account.key();
        entry.position = position.key();
        entry.owner = position.owner;
        entry.team_id = position.team_id;
        entry.amount_lamports = amount;
        entry.settled = false;
        entry.is_winner = false;
        entry.payout_lamports = 0;
        entry.bump = ctx.bumps.cycle_entry;

        Ok(())
    }

    pub fn begin_position_settlement(
        ctx: Context<BeginPositionSettlement>,
        winning_team_id: u8,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        require_keys_eq!(
            config.authority,
            ctx.accounts.authority.key(),
            BettingError::Unauthorized
        );

        let match_account = &mut ctx.accounts.match_account;
        require_eq!(match_account.status, MatchStatus::Open as u8, BettingError::AlreadySettled);
        require!(
            winning_team_id == match_account.team_a_id || winning_team_id == match_account.team_b_id,
            BettingError::InvalidTeam
        );

        match_account.status = MatchStatus::SettlingLosers as u8;
        match_account.winning_team_id = winning_team_id;
        match_account.total_pool = 0;

        Ok(())
    }

    pub fn settle_loser_position(
        ctx: Context<SettleLoserPosition>,
        house_fee_bps: u16,
        loser_refund_bps: u16,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        require_keys_eq!(
            config.authority,
            ctx.accounts.authority.key(),
            BettingError::Unauthorized
        );
        require!(
            (house_fee_bps as u32) + (loser_refund_bps as u32) <= 10_000,
            BettingError::InvalidSettlementRate
        );

        let match_account = &mut ctx.accounts.match_account;
        let position = &mut ctx.accounts.position;
        let entry = &mut ctx.accounts.cycle_entry;

        require_eq!(
            match_account.status,
            MatchStatus::SettlingLosers as u8,
            BettingError::InvalidSettlementPhase
        );
        require!(!entry.settled, BettingError::AlreadyClaimed);
        require_keys_eq!(entry.match_account, match_account.key(), BettingError::InvalidMatch);
        require_keys_eq!(entry.position, position.key(), BettingError::InvalidPosition);
        require!(entry.team_id != match_account.winning_team_id, BettingError::InvalidSettlementPhase);

        let amount = entry.amount_lamports;
        let refund = bps_amount(amount, loser_refund_bps)?;
        let fee = bps_amount(amount, house_fee_bps)?;
        let distributable = amount
            .checked_sub(refund)
            .ok_or(BettingError::MathOverflow)?
            .checked_sub(fee)
            .ok_or(BettingError::MathOverflow)?;

        move_lamports(
            &ctx.accounts.position_vault.to_account_info(),
            &ctx.accounts.fee_vault.to_account_info(),
            fee,
        )?;
        move_lamports(
            &ctx.accounts.position_vault.to_account_info(),
            &ctx.accounts.match_vault.to_account_info(),
            distributable,
        )?;

        position.current_lamports = refund;
        position.locked_lamports = 0;
        if position.current_lamports == 0 {
            position.status = PositionStatus::Paused as u8;
        }

        entry.settled = true;
        entry.is_winner = false;
        entry.payout_lamports = refund;

        match_account.total_pool = match_account
            .total_pool
            .checked_add(distributable)
            .ok_or(BettingError::MathOverflow)?;

        Ok(())
    }

    pub fn start_winner_settlement(ctx: Context<StartWinnerSettlement>) -> Result<()> {
        let config = &ctx.accounts.config;
        require_keys_eq!(
            config.authority,
            ctx.accounts.authority.key(),
            BettingError::Unauthorized
        );

        let match_account = &mut ctx.accounts.match_account;
        require_eq!(
            match_account.status,
            MatchStatus::SettlingLosers as u8,
            BettingError::InvalidSettlementPhase
        );
        match_account.status = MatchStatus::SettlingWinners as u8;

        Ok(())
    }

    pub fn settle_winner_position(ctx: Context<SettleWinnerPosition>) -> Result<()> {
        let config = &ctx.accounts.config;
        require_keys_eq!(
            config.authority,
            ctx.accounts.authority.key(),
            BettingError::Unauthorized
        );

        let match_account = &ctx.accounts.match_account;
        let position = &mut ctx.accounts.position;
        let entry = &mut ctx.accounts.cycle_entry;

        require_eq!(
            match_account.status,
            MatchStatus::SettlingWinners as u8,
            BettingError::InvalidSettlementPhase
        );
        require!(!entry.settled, BettingError::AlreadyClaimed);
        require_keys_eq!(entry.match_account, match_account.key(), BettingError::InvalidMatch);
        require_keys_eq!(entry.position, position.key(), BettingError::InvalidPosition);
        require_eq!(entry.team_id, match_account.winning_team_id, BettingError::InvalidSettlementPhase);

        let winning_total = if match_account.winning_team_id == match_account.team_a_id {
            match_account.total_team_a
        } else {
            match_account.total_team_b
        };
        require!(winning_total > 0, BettingError::NoWinningPool);

        let profit = ((entry.amount_lamports as u128)
            .checked_mul(match_account.total_pool as u128)
            .ok_or(BettingError::MathOverflow)?
            / winning_total as u128) as u64;
        let payout = entry
            .amount_lamports
            .checked_add(profit)
            .ok_or(BettingError::MathOverflow)?;

        move_lamports(
            &ctx.accounts.match_vault.to_account_info(),
            &ctx.accounts.position_vault.to_account_info(),
            profit,
        )?;

        position.current_lamports = payout;
        position.locked_lamports = 0;

        entry.settled = true;
        entry.is_winner = true;
        entry.payout_lamports = payout;

        Ok(())
    }

    pub fn finalize_position_match(ctx: Context<FinalizePositionMatch>) -> Result<()> {
        let config = &ctx.accounts.config;
        require_keys_eq!(
            config.authority,
            ctx.accounts.authority.key(),
            BettingError::Unauthorized
        );

        let match_account = &mut ctx.accounts.match_account;
        require_eq!(
            match_account.status,
            MatchStatus::SettlingWinners as u8,
            BettingError::InvalidSettlementPhase
        );
        match_account.status = MatchStatus::Settled as u8;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = Config::SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct CreateMatch<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = MatchAccount::SPACE,
        seeds = [b"match".as_ref(), match_id.to_le_bytes().as_ref()],
        bump
    )]
    pub match_account: Account<'info, MatchAccount>,
    #[account(
        init,
        payer = authority,
        space = 0,
        seeds = [b"vault", match_account.key().as_ref()],
        bump
    )]
    /// CHECK: PDA vault owned by this program and used only for lamport escrow.
    pub vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct PlaceBet<'info> {
    #[account(
        mut,
        seeds = [b"match".as_ref(), match_id.to_le_bytes().as_ref()],
        bump = match_account.bump
    )]
    pub match_account: Account<'info, MatchAccount>,
    #[account(
        mut,
        seeds = [b"vault", match_account.key().as_ref()],
        bump = match_account.vault_bump
    )]
    /// CHECK: PDA vault verified by seeds.
    pub vault: UncheckedAccount<'info>,
    #[account(
        init,
        payer = bettor,
        space = BetAccount::SPACE,
        seeds = [b"bet", match_account.key().as_ref(), bettor.key().as_ref()],
        bump
    )]
    pub bet: Account<'info, BetAccount>,
    #[account(mut)]
    pub bettor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleMatch<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub match_account: Account<'info, MatchAccount>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimPayout<'info> {
    pub match_account: Account<'info, MatchAccount>,
    #[account(
        mut,
        seeds = [b"vault", match_account.key().as_ref()],
        bump = match_account.vault_bump
    )]
    /// CHECK: PDA vault verified by seeds.
    pub vault: UncheckedAccount<'info>,
    #[account(mut, has_one = match_account, has_one = bettor)]
    pub bet: Account<'info, BetAccount>,
    #[account(mut)]
    pub bettor: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(team_id: u8)]
pub struct CreatePosition<'info> {
    #[account(
        init,
        payer = owner,
        space = PositionAccount::SPACE,
        seeds = [b"position", owner.key().as_ref(), &[team_id]],
        bump
    )]
    pub position: Account<'info, PositionAccount>,
    #[account(
        init,
        payer = owner,
        space = 0,
        seeds = [b"position_vault", position.key().as_ref()],
        bump
    )]
    /// CHECK: PDA vault owned by this program and used only for position lamports.
    pub position_vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositPosition<'info> {
    #[account(
        mut,
        seeds = [b"position", owner.key().as_ref(), &[position.team_id]],
        bump = position.bump
    )]
    pub position: Account<'info, PositionAccount>,
    #[account(
        mut,
        seeds = [b"position_vault", position.key().as_ref()],
        bump = position.vault_bump
    )]
    /// CHECK: PDA vault verified by seeds.
    pub position_vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestClosePosition<'info> {
    #[account(
        mut,
        close = owner,
        seeds = [b"position", owner.key().as_ref(), &[position.team_id]],
        bump = position.bump
    )]
    pub position: Account<'info, PositionAccount>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(
        mut,
        seeds = [b"position", owner.key().as_ref(), &[position.team_id]],
        bump = position.bump
    )]
    pub position: Account<'info, PositionAccount>,
    #[account(
        mut,
        seeds = [b"position_vault", position.key().as_ref()],
        bump = position.vault_bump
    )]
    /// CHECK: PDA vault verified by seeds.
    pub position_vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct EnterPositionCycle<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub match_account: Account<'info, MatchAccount>,
    #[account(mut)]
    pub position: Account<'info, PositionAccount>,
    #[account(
        init,
        payer = authority,
        space = CycleEntryAccount::SPACE,
        seeds = [b"cycle_entry", match_account.key().as_ref(), position.key().as_ref()],
        bump
    )]
    pub cycle_entry: Account<'info, CycleEntryAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BeginPositionSettlement<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub match_account: Account<'info, MatchAccount>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SettleLoserPosition<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub match_account: Account<'info, MatchAccount>,
    #[account(mut)]
    pub position: Account<'info, PositionAccount>,
    #[account(
        mut,
        seeds = [b"position_vault", position.key().as_ref()],
        bump = position.vault_bump
    )]
    /// CHECK: PDA vault verified by seeds.
    pub position_vault: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"vault", match_account.key().as_ref()],
        bump = match_account.vault_bump
    )]
    /// CHECK: PDA vault verified by seeds.
    pub match_vault: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Fee receiver selected by the program authority during settlement.
    pub fee_vault: UncheckedAccount<'info>,
    #[account(mut, has_one = match_account, has_one = position)]
    pub cycle_entry: Account<'info, CycleEntryAccount>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct StartWinnerSettlement<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub match_account: Account<'info, MatchAccount>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SettleWinnerPosition<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub match_account: Account<'info, MatchAccount>,
    #[account(mut)]
    pub position: Account<'info, PositionAccount>,
    #[account(
        mut,
        seeds = [b"position_vault", position.key().as_ref()],
        bump = position.vault_bump
    )]
    /// CHECK: PDA vault verified by seeds.
    pub position_vault: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"vault", match_account.key().as_ref()],
        bump = match_account.vault_bump
    )]
    /// CHECK: PDA vault verified by seeds.
    pub match_vault: UncheckedAccount<'info>,
    #[account(mut, has_one = match_account, has_one = position)]
    pub cycle_entry: Account<'info, CycleEntryAccount>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct FinalizePositionMatch<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub match_account: Account<'info, MatchAccount>,
    pub authority: Signer<'info>,
}

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub bump: u8,
}

impl Config {
    pub const SPACE: usize = 8 + 32 + 1;
}

#[account]
pub struct MatchAccount {
    pub match_id: u64,
    pub team_a_id: u8,
    pub team_b_id: u8,
    pub betting_close_ts: i64,
    pub status: u8,
    pub winning_team_id: u8,
    pub total_team_a: u64,
    pub total_team_b: u64,
    pub total_pool: u64,
    pub bet_count: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl MatchAccount {
    pub const SPACE: usize = 8 + 8 + 1 + 1 + 8 + 1 + 1 + 8 + 8 + 8 + 8 + 1 + 1;
}

#[account]
pub struct BetAccount {
    pub match_account: Pubkey,
    pub bettor: Pubkey,
    pub team_id: u8,
    pub amount_lamports: u64,
    pub claimed: bool,
    pub bump: u8,
}

impl BetAccount {
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 8 + 1 + 1;
}

#[account]
pub struct PositionAccount {
    pub owner: Pubkey,
    pub team_id: u8,
    pub principal_lamports: u64,
    pub current_lamports: u64,
    pub locked_lamports: u64,
    pub status: u8,
    pub bump: u8,
    pub vault_bump: u8,
}

impl PositionAccount {
    pub const SPACE: usize = 8 + 32 + 1 + 8 + 8 + 8 + 1 + 1 + 1;
}

#[account]
pub struct CycleEntryAccount {
    pub match_account: Pubkey,
    pub position: Pubkey,
    pub owner: Pubkey,
    pub team_id: u8,
    pub amount_lamports: u64,
    pub settled: bool,
    pub is_winner: bool,
    pub payout_lamports: u64,
    pub bump: u8,
}

impl CycleEntryAccount {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 1 + 8 + 1 + 1 + 8 + 1;
}

#[repr(u8)]
pub enum MatchStatus {
    Open = 1,
    Settled = 2,
    SettlingLosers = 3,
    SettlingWinners = 4,
}

#[repr(u8)]
pub enum PositionStatus {
    Active = 1,
    ClosingRequested = 2,
    Closed = 3,
    Paused = 4,
}

fn bps_amount(amount: u64, bps: u16) -> Result<u64> {
    Ok(((amount as u128)
        .checked_mul(bps as u128)
        .ok_or(BettingError::MathOverflow)?
        / 10_000u128) as u64)
}

fn move_lamports<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }

    let from_lamports = from.lamports();
    let to_lamports = to.lamports();

    require!(from_lamports >= amount, BettingError::InsufficientVaultBalance);

    **from.try_borrow_mut_lamports()? = from_lamports
        .checked_sub(amount)
        .ok_or(BettingError::MathOverflow)?;
    **to.try_borrow_mut_lamports()? = to_lamports
        .checked_add(amount)
        .ok_or(BettingError::MathOverflow)?;

    Ok(())
}

#[error_code]
pub enum BettingError {
    #[msg("Somente a autoridade do programa pode executar esta ação.")]
    Unauthorized,
    #[msg("Time inválido para esta partida.")]
    InvalidTeam,
    #[msg("Valor de investimento inválido.")]
    InvalidAmount,
    #[msg("Partida inválida.")]
    InvalidMatch,
    #[msg("A janela de investimentos está fechada.")]
    BettingClosed,
    #[msg("A partida já foi liquidada.")]
    AlreadySettled,
    #[msg("A partida ainda não foi liquidada.")]
    NotSettled,
    #[msg("Este investimento já foi reivindicado.")]
    AlreadyClaimed,
    #[msg("Não existe pool vencedor para esta partida.")]
    NoWinningPool,
    #[msg("Saldo insuficiente no vault.")]
    InsufficientVaultBalance,
    #[msg("Overflow matemático.")]
    MathOverflow,
    #[msg("A posição está fechada.")]
    PositionClosed,
    #[msg("A posição ainda possui capital travado em um ciclo.")]
    PositionLocked,
    #[msg("Posição inválida para este ciclo.")]
    InvalidPosition,
    #[msg("Fase de liquidação inválida.")]
    InvalidSettlementPhase,
    #[msg("Taxas de liquidação inválidas.")]
    InvalidSettlementRate,
}
