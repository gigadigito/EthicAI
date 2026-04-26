use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke_signed, system_instruction};

declare_id!("4Ck537z1KEw1Azn9EHMvrW6xUhXGCUhDpSBJh6j5xjSX");

const SETTLEMENT_ID_MAX_LEN: usize = 32;

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
        vault.created_at = Clock::get()?.unix_timestamp;

        Ok(())
    }

    pub fn init_user_account(ctx: Context<InitUserAccount>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let user_account = &mut ctx.accounts.user_account;

        user_account.owner = ctx.accounts.owner.key();
        user_account.system_balance = 0;
        user_account.total_credited = 0;
        user_account.total_withdrawn = 0;
        user_account.created_at = now;
        user_account.updated_at = now;
        user_account.bump = ctx.bumps.user_account;

        Ok(())
    }

    pub fn credit_user_balance(
        ctx: Context<CreditUserBalance>,
        amount: u64,
        settlement_id: String,
    ) -> Result<()> {
        require_authority(&ctx.accounts.config, &ctx.accounts.authority)?;
        require!(amount > 0, BettingError::InvalidAmount);
        require!(
            !settlement_id.is_empty() && settlement_id.len() <= SETTLEMENT_ID_MAX_LEN,
            BettingError::InvalidSettlementId
        );
        require_keys_eq!(
            ctx.accounts.user_account.owner,
            ctx.accounts.user_wallet.key(),
            BettingError::Unauthorized
        );

        let now = Clock::get()?.unix_timestamp;
        let user_account = &mut ctx.accounts.user_account;
        user_account.system_balance = user_account
            .system_balance
            .checked_add(amount)
            .ok_or(BettingError::MathOverflow)?;
        user_account.total_credited = user_account
            .total_credited
            .checked_add(amount)
            .ok_or(BettingError::MathOverflow)?;
        user_account.updated_at = now;

        let receipt = &mut ctx.accounts.receipt;
        receipt.user = ctx.accounts.user_wallet.key();
        receipt.amount = amount;
        receipt.settlement_id = settlement_id;
        receipt.credited_at = now;
        receipt.bump = ctx.bumps.receipt;

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
pub struct InitUserAccount<'info> {
    #[account(
        init,
        payer = owner,
        space = UserAccount::SPACE,
        seeds = [b"user", owner.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64, settlement_id: String)]
pub struct CreditUserBalance<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"user", user_wallet.key().as_ref()],
        bump = user_account.bump
    )]
    pub user_account: Account<'info, UserAccount>,
    /// CHECK: only used as PDA seed and ownership assertion target.
    pub user_wallet: UncheckedAccount<'info>,
    #[account(
        init,
        payer = authority,
        space = SettlementReceipt::space_for_settlement_id(&settlement_id),
        seeds = [b"receipt", user_wallet.key().as_ref(), settlement_id.as_bytes()],
        bump
    )]
    pub receipt: Account<'info, SettlementReceipt>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
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
    pub created_at: i64,
}

impl VaultAccount {
    pub const SPACE: usize = 8 + 1 + 8;
}

#[account]
pub struct UserAccount {
    pub owner: Pubkey,
    pub system_balance: u64,
    pub total_credited: u64,
    pub total_withdrawn: u64,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

impl UserAccount {
    pub const SPACE: usize = 8 + 32 + 8 + 8 + 8 + 8 + 8 + 1;
}

#[account]
pub struct SettlementReceipt {
    pub user: Pubkey,
    pub amount: u64,
    pub settlement_id: String,
    pub credited_at: i64,
    pub bump: u8,
}

impl SettlementReceipt {
    pub fn space_for_settlement_id(settlement_id: &str) -> usize {
        8 + 32 + 8 + 4 + settlement_id.len() + 8 + 1
    }
}

fn require_authority(config: &Account<Config>, authority: &Signer) -> Result<()> {
    require_keys_eq!(config.authority, authority.key(), BettingError::Unauthorized);
    Ok(())
}

#[error_code]
pub enum BettingError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("InsufficientSystemBalance")]
    InsufficientSystemBalance,
    #[msg("NothingToWithdraw")]
    NothingToWithdraw,
    #[msg("InvalidVault")]
    InvalidVault,
    #[msg("MathOverflow")]
    MathOverflow,
    #[msg("InvalidAmount")]
    InvalidAmount,
    #[msg("InvalidSettlementId")]
    InvalidSettlementId,
}
