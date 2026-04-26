# CriptoVersus Betting Program

Anchor program for the simplified devnet custody flow.

## On-Chain Scope

The blockchain now stores only:

1. `Config`
2. `VaultAccount`
3. `UserAccount`
4. `SettlementReceipt`

The backend remains the source of truth for:

1. matches
2. bets
3. payout calculation
4. history

## Flow

1. `initialize_config` creates the authority config and vault PDA.
2. `init_user_account` creates the consolidated user balance PDA.
3. `credit_user_balance` credits a user's `system_balance` using an admin-authorized `settlement_id`.
4. `withdraw` transfers lamports from the vault PDA to the user's wallet.

## Build And Deploy

Install Rust and Anchor, then run:

```powershell
cd solana\criptoversus_betting
solana config set --url devnet
anchor build
anchor keys sync
anchor deploy
```

After deploy, copy the generated program id into:

- `programs/criptoversus_betting/src/lib.rs`
- `Anchor.toml`
- `CriptoVersus/appsettings.json` under `OnChainBetting:ProgramId`

If you changed the program layout from an older version, do not reuse old initialized state blindly. The safest path is:

1. deploy the final contract version
2. initialize fresh `config` and `vault`
3. initialize each required `user_account`
4. start crediting users with `settlement_id`

## Devnet Checklist

Run these scripts in Solana Playground or adapt them for your local Anchor client:

1. `initialize-config-devnet.ts`
2. `init-user-account-devnet.ts`
3. `credit-user-balance-devnet.ts`

`create-match-devnet.ts` is now obsolete and kept only as a reminder that the old per-match flow is no longer used.

## Practical Recovery For Current Withdraw Error

If `withdraw` fails with `config -> AccountDidNotDeserialize`, the deployed program and the stored `config` account are out of sync.

Recovery path:

1. Confirm the final `ProgramId` you want to keep.
2. Deploy the simplified contract matching `programs/criptoversus_betting/src/lib.rs`.
3. Update `Anchor.toml` and `CriptoVersus/appsettings.json` to the same `ProgramId`.
4. Run `initialize-config-devnet.ts` with the authority wallet.
5. Run `init-user-account-devnet.ts` for the target user wallet.
6. Credit the user through `credit-user-balance-devnet.ts` or your backend admin flow.
7. Retry `withdraw` from the application.
