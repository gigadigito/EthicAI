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
        seeds = [b"match", &match_id.to_le_bytes()],
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
        seeds = [b"match", &match_id.to_le_bytes()],
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

#[repr(u8)]
pub enum MatchStatus {
    Open = 1,
    Settled = 2,
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
}
