use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, program::invoke_signed, system_instruction};

declare_id!("4Ck537z1KEw1Azn9EHMvrW6xUhXGCUhDpSBJh6j5xjSX");

#[program]
pub mod criptoversus_betting {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.bump = ctx.bumps.config;
        config.vault_bump = ctx.bumps.vault;

        let vault = &mut ctx.accounts.vault;
        vault.bump = ctx.bumps.vault;

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
        require_authority(&ctx.accounts.config, &ctx.accounts.authority)?;

        let match_account = &mut ctx.accounts.match_account;
        match_account.match_id = match_id;
        match_account.team_a_id = team_a_id;
        match_account.team_b_id = team_b_id;
        match_account.betting_close_ts = betting_close_ts;
        match_account.status = MatchLifecycle::Open as u8;
        match_account.settled = false;
        match_account.winner_team = 0;
        match_account.bump = ctx.bumps.match_account;

        Ok(())
    }

    pub fn place_bet(
        ctx: Context<PlaceBet>,
        match_id: u64,
        team_id: u8,
        amount_lamports: u64,
    ) -> Result<()> {
        require!(amount_lamports > 0, BettingError::InvalidAmount);

        let now = Clock::get()?.unix_timestamp;
        let match_account = &ctx.accounts.match_account;

        require_eq!(match_account.match_id, match_id, BettingError::InvalidMatch);
        require_eq!(match_account.status, MatchLifecycle::Open as u8, BettingError::BettingClosed);
        require!(now <= match_account.betting_close_ts, BettingError::BettingClosed);
        require!(
            team_id == match_account.team_a_id || team_id == match_account.team_b_id,
            BettingError::InvalidTeam
        );

        invoke(
            &system_instruction::transfer(
                &ctx.accounts.owner.key(),
                &ctx.accounts.vault.key(),
                amount_lamports,
            ),
            &[
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        let user_account = &mut ctx.accounts.user_account;
        if user_account.owner == Pubkey::default() {
            user_account.owner = ctx.accounts.owner.key();
            user_account.system_balance = 0;
            user_account.total_claimed = 0;
            user_account.total_withdrawn = 0;
            user_account.created_at = now;
            user_account.bump = ctx.bumps.user_account;
        }
        user_account.updated_at = now;

        let bet = &mut ctx.accounts.bet;
        bet.owner = ctx.accounts.owner.key();
        bet.match_account = match_account.key();
        bet.match_id = match_id;
        bet.team_id = team_id;
        bet.amount_lamports = amount_lamports;
        bet.payout_amount = 0;
        bet.is_settled = false;
        bet.is_winner = false;
        bet.claimed = false;
        bet.claimed_at = 0;
        bet.settled_at = 0;
        bet.created_at = now;
        bet.bump = ctx.bumps.bet;

        Ok(())
    }

    pub fn settle_match(ctx: Context<SettleMatch>, winning_team_id: u8) -> Result<()> {
        require_authority(&ctx.accounts.config, &ctx.accounts.authority)?;

        let match_account = &mut ctx.accounts.match_account;
        require!(!match_account.settled, BettingError::AlreadySettled);
        require!(
            winning_team_id == match_account.team_a_id || winning_team_id == match_account.team_b_id,
            BettingError::InvalidTeam
        );

        match_account.status = MatchLifecycle::Settled as u8;
        match_account.settled = true;
        match_account.winner_team = winning_team_id;

        Ok(())
    }

    pub fn settle_bet(
        ctx: Context<SettleBet>,
        payout_amount: u64,
        is_winner: bool,
    ) -> Result<()> {
        require_authority(&ctx.accounts.config, &ctx.accounts.authority)?;

        let match_account = &ctx.accounts.match_account;
        let bet = &mut ctx.accounts.bet;

        require!(match_account.settled, BettingError::BetNotSettled);
        require_keys_eq!(bet.match_account, match_account.key(), BettingError::InvalidBetMatch);
        require!(!bet.is_settled, BettingError::AlreadySettled);

        bet.payout_amount = payout_amount;
        bet.is_settled = true;
        bet.is_winner = is_winner;
        bet.settled_at = Clock::get()?.unix_timestamp;

        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let match_account = &ctx.accounts.match_account;
        let bet = &mut ctx.accounts.bet;
        let user_account = &mut ctx.accounts.user_account;
        let now = Clock::get()?.unix_timestamp;

        require_keys_eq!(bet.owner, ctx.accounts.owner.key(), BettingError::Unauthorized);
        require!(match_account.settled && bet.is_settled, BettingError::BetNotSettled);
        require_keys_eq!(bet.match_account, match_account.key(), BettingError::InvalidBetMatch);
        require!(!bet.claimed, BettingError::AlreadyClaimed);
        require!(bet.payout_amount > 0, BettingError::NothingToClaim);
        require_keys_eq!(user_account.owner, ctx.accounts.owner.key(), BettingError::Unauthorized);

        user_account.system_balance = user_account
            .system_balance
            .checked_add(bet.payout_amount)
            .ok_or(BettingError::MathOverflow)?;
        user_account.total_claimed = user_account
            .total_claimed
            .checked_add(bet.payout_amount)
            .ok_or(BettingError::MathOverflow)?;
        user_account.updated_at = now;

        bet.claimed = true;
        bet.claimed_at = now;

        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, BettingError::NothingToWithdraw);

        let user_account = &mut ctx.accounts.user_account;
        require_keys_eq!(user_account.owner, ctx.accounts.owner.key(), BettingError::Unauthorized);
        require!(user_account.system_balance > 0, BettingError::NothingToWithdraw);
        require!(amount <= user_account.system_balance, BettingError::InsufficientSystemBalance);

        let rent = Rent::get()?;
        let minimum_vault_balance = rent.minimum_balance(VaultAccount::SPACE);
        let vault_balance = ctx.accounts.vault.to_account_info().lamports();
        let withdrawable_balance = vault_balance
            .checked_sub(minimum_vault_balance)
            .ok_or(BettingError::InvalidVault)?;

        require!(amount <= withdrawable_balance, BettingError::InvalidVault);

        invoke_signed(
            &system_instruction::transfer(
                &ctx.accounts.vault.key(),
                &ctx.accounts.owner.key(),
                amount,
            ),
            &[
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[&[b"vault", &[ctx.accounts.config.vault_bump]]],
        )?;

        user_account.system_balance = user_account
            .system_balance
            .checked_sub(amount)
            .ok_or(BettingError::MathOverflow)?;
        user_account.total_withdrawn = user_account
            .total_withdrawn
            .checked_add(amount)
            .ok_or(BettingError::MathOverflow)?;
        user_account.updated_at = Clock::get()?.unix_timestamp;

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
    #[account(
        init,
        payer = authority,
        space = VaultAccount::SPACE,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Account<'info, VaultAccount>,
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
        seeds = [b"match", match_id.to_le_bytes().as_ref()],
        bump
    )]
    pub match_account: Account<'info, MatchAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct PlaceBet<'info> {
    #[account(
        mut,
        seeds = [b"match", match_id.to_le_bytes().as_ref()],
        bump = match_account.bump
    )]
    pub match_account: Account<'info, MatchAccount>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"vault"],
        bump = config.vault_bump
    )]
    pub vault: Account<'info, VaultAccount>,
    #[account(
        init_if_needed,
        payer = owner,
        space = UserAccount::SPACE,
        seeds = [b"user", owner.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(
        init,
        payer = owner,
        space = BetAccount::SPACE,
        seeds = [b"bet", match_account.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub bet: Account<'info, BetAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
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
pub struct SettleBet<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub match_account: Account<'info, MatchAccount>,
    #[account(mut)]
    pub bet: Account<'info, BetAccount>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    pub match_account: Account<'info, MatchAccount>,
    #[account(
        mut,
        seeds = [b"user", owner.key().as_ref()],
        bump = user_account.bump
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub bet: Account<'info, BetAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"vault"],
        bump = config.vault_bump
    )]
    pub vault: Account<'info, VaultAccount>,
    #[account(
        mut,
        seeds = [b"user", owner.key().as_ref()],
        bump = user_account.bump
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Config {
    pub const SPACE: usize = 8 + 32 + 1 + 1;
}

#[account]
pub struct VaultAccount {
    pub bump: u8,
}

impl VaultAccount {
    pub const SPACE: usize = 8 + 1;
}

#[account]
pub struct UserAccount {
    pub owner: Pubkey,
    pub system_balance: u64,
    pub total_claimed: u64,
    pub total_withdrawn: u64,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

impl UserAccount {
    pub const SPACE: usize = 8 + 32 + 8 + 8 + 8 + 8 + 8 + 1;
}

#[account]
pub struct BetAccount {
    pub owner: Pubkey,
    pub match_account: Pubkey,
    pub match_id: u64,
    pub team_id: u8,
    pub amount_lamports: u64,
    pub payout_amount: u64,
    pub is_settled: bool,
    pub is_winner: bool,
    pub claimed: bool,
    pub claimed_at: i64,
    pub settled_at: i64,
    pub created_at: i64,
    pub bump: u8,
}

impl BetAccount {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1 + 8 + 8 + 1 + 1 + 1 + 8 + 8 + 8 + 1;
}

#[account]
pub struct MatchAccount {
    pub match_id: u64,
    pub team_a_id: u8,
    pub team_b_id: u8,
    pub betting_close_ts: i64,
    pub status: u8,
    pub settled: bool,
    pub winner_team: u8,
    pub bump: u8,
}

impl MatchAccount {
    pub const SPACE: usize = 8 + 8 + 1 + 1 + 8 + 1 + 1 + 1;
}

#[repr(u8)]
pub enum MatchLifecycle {
    Open = 1,
    Settled = 2,
}

fn require_authority(config: &Account<Config>, authority: &Signer) -> Result<()> {
    require_keys_eq!(config.authority, authority.key(), BettingError::Unauthorized);
    Ok(())
}

#[error_code]
pub enum BettingError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("BetNotSettled")]
    BetNotSettled,
    #[msg("AlreadyClaimed")]
    AlreadyClaimed,
    #[msg("NothingToClaim")]
    NothingToClaim,
    #[msg("InvalidBetMatch")]
    InvalidBetMatch,
    #[msg("InsufficientSystemBalance")]
    InsufficientSystemBalance,
    #[msg("NothingToWithdraw")]
    NothingToWithdraw,
    #[msg("InvalidVault")]
    InvalidVault,
    #[msg("MathOverflow")]
    MathOverflow,
    #[msg("InvalidTeam")]
    InvalidTeam,
    #[msg("InvalidAmount")]
    InvalidAmount,
    #[msg("InvalidMatch")]
    InvalidMatch,
    #[msg("BettingClosed")]
    BettingClosed,
    #[msg("AlreadySettled")]
    AlreadySettled,
}
