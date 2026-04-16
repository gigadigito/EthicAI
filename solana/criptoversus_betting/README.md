# CriptoVersus Betting Program

Anchor program for devnet SOL escrow betting.

## Flow

1. `initialize_config` stores the authority wallet.
2. `create_match` creates a match PDA and a vault PDA.
3. `place_bet` transfers lamports from the bettor wallet to the vault PDA.
4. `settle_match` records the winning team.
5. `claim_payout` pays winners proportionally from the vault.

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

Then create the on-chain config and matches with an Anchor script or CLI client.
