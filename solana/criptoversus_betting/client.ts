import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";

type CriptoVersusProgram = Program;

function pda(programId: PublicKey, seeds: (Buffer | Uint8Array)[]) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.CriptoVersusBetting as CriptoVersusProgram;
  const wallet = provider.wallet.publicKey;
  const matchId = new anchor.BN(1);
  const payout = new anchor.BN(1_350_000_000);
  const withdrawPartial = new anchor.BN(350_000_000);
  const withdrawTotal = new anchor.BN(1_000_000_000);

  const config = pda(program.programId, [Buffer.from("config")]);
  const vault = pda(program.programId, [Buffer.from("vault")]);
  const userAccount = pda(program.programId, [Buffer.from("user"), wallet.toBuffer()]);
  const matchAccount = pda(program.programId, [Buffer.from("match"), matchId.toArrayLike(Buffer, "le", 8)]);
  const bet = pda(program.programId, [Buffer.from("bet"), matchAccount.toBuffer(), wallet.toBuffer()]);

  console.log("PDAs", {
    config: config.toBase58(),
    vault: vault.toBase58(),
    userAccount: userAccount.toBase58(),
    matchAccount: matchAccount.toBase58(),
    bet: bet.toBase58()
  });

  console.log("1. place_bet");
  await program.methods
    .placeBet(matchId, 1, new anchor.BN(1_000_000_000))
    .accounts({
      matchAccount,
      config,
      vault,
      userAccount,
      bet,
      owner: wallet,
      systemProgram: SystemProgram.programId
    })
    .rpc();

  console.log("2. settle_match");
  await program.methods
    .settleMatch(1)
    .accounts({
      config,
      matchAccount,
      authority: wallet
    })
    .rpc();

  console.log("3. settle_bet");
  await program.methods
    .settleBet(payout, true)
    .accounts({
      config,
      matchAccount,
      bet,
      authority: wallet
    })
    .rpc();

  const betAfterSettlement = await program.account.betAccount.fetch(bet);
  console.log("4. available returns", betAfterSettlement.payoutAmount.toString());

  console.log("5. claim");
  await program.methods
    .claim()
    .accounts({
      matchAccount,
      userAccount,
      bet,
      owner: wallet
    })
    .rpc();

  const userAfterClaim = await program.account.userAccount.fetch(userAccount);
  console.log("6. system_balance", userAfterClaim.systemBalance.toString());

  console.log("7. duplicate claim should fail");
  try {
    await program.methods
      .claim()
      .accounts({
        matchAccount,
        userAccount,
        bet,
        owner: wallet
      })
      .rpc();
    throw new Error("duplicate claim unexpectedly succeeded");
  } catch (error) {
    console.log("duplicate claim failed as expected");
  }

  console.log("8. partial withdraw");
  await program.methods
    .withdraw(withdrawPartial)
    .accounts({
      config,
      vault,
      userAccount,
      owner: wallet,
      systemProgram: SystemProgram.programId
    })
    .rpc();

  console.log("9. total withdraw");
  await program.methods
    .withdraw(withdrawTotal)
    .accounts({
      config,
      vault,
      userAccount,
      owner: wallet,
      systemProgram: SystemProgram.programId
    })
    .rpc();

  console.log("10. withdraw without balance should fail");
  try {
    await program.methods
      .withdraw(new anchor.BN(1))
      .accounts({
        config,
        vault,
        userAccount,
        owner: wallet,
        systemProgram: SystemProgram.programId
      })
      .rpc();
    throw new Error("withdraw without balance unexpectedly succeeded");
  } catch (error) {
    console.log("withdraw without balance failed as expected");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
