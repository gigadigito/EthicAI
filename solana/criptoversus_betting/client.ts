import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";

type CriptoVersusProgram = Program;

function pda(programId: PublicKey, seeds: (Buffer | Uint8Array)[]) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

async function airdropIfNeeded(connection: anchor.web3.Connection, address: PublicKey, minimumLamports: number) {
  const balance = await connection.getBalance(address);
  if (balance >= minimumLamports) {
    return;
  }

  const signature = await connection.requestAirdrop(address, minimumLamports - balance + LAMPORTS_PER_SOL);
  await connection.confirmTransaction(signature, "confirmed");
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.CriptoVersusBetting as CriptoVersusProgram;
  const admin = provider.wallet.publicKey;
  const user = provider.wallet.publicKey;
  const settlementId = "settlement-001";
  const creditAmount = new anchor.BN(1_350_000_000);
  const withdrawPartial = new anchor.BN(350_000_000);
  const withdrawTotal = new anchor.BN(1_000_000_000);

  const config = pda(program.programId, [Buffer.from("config")]);
  const vault = pda(program.programId, [Buffer.from("vault")]);
  const userAccount = pda(program.programId, [Buffer.from("user"), user.toBuffer()]);
  const receipt = pda(program.programId, [Buffer.from("receipt"), user.toBuffer(), Buffer.from(settlementId)]);

  console.log("PDAs", {
    config: config.toBase58(),
    vault: vault.toBase58(),
    userAccount: userAccount.toBase58(),
    receipt: receipt.toBase58()
  });

  await airdropIfNeeded(provider.connection, admin, 3 * LAMPORTS_PER_SOL);

  console.log("1. initialize_config");
  await program.methods
    .initializeConfig()
    .accounts({
      config,
      vault,
      authority: admin,
      systemProgram: SystemProgram.programId
    })
    .rpc();

  console.log("2. init_user_account");
  await program.methods
    .initUserAccount()
    .accounts({
      userAccount,
      owner: user,
      systemProgram: SystemProgram.programId
    })
    .rpc();

  console.log("3. fund vault for withdraw tests");
  const fundVaultSignature = await provider.sendAndConfirm(
    new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin,
        toPubkey: vault,
        lamports: creditAmount.toNumber()
      })
    )
  );
  console.log("vault funding tx", fundVaultSignature);

  console.log("4. credit_user_balance as admin");
  await program.methods
    .creditUserBalance(creditAmount, settlementId)
    .accounts({
      config,
      userAccount,
      userWallet: user,
      receipt,
      authority: admin,
      systemProgram: SystemProgram.programId
    })
    .rpc();

  const userAfterCredit = await program.account.userAccount.fetch(userAccount);
  console.log("5. system_balance", userAfterCredit.systemBalance.toString());

  console.log("6. duplicate credit should fail");
  try {
    await program.methods
      .creditUserBalance(creditAmount, settlementId)
      .accounts({
        config,
        userAccount,
        userWallet: user,
        receipt,
        authority: admin,
        systemProgram: SystemProgram.programId
      })
      .rpc();
    throw new Error("duplicate credit unexpectedly succeeded");
  } catch (error) {
    console.log("duplicate credit failed as expected");
  }

  console.log("7. partial withdraw");
  await program.methods
    .withdraw(withdrawPartial)
    .accounts({
      config,
      vault,
      userAccount,
      owner: user,
      systemProgram: SystemProgram.programId
    })
    .rpc();

  const userAfterPartialWithdraw = await program.account.userAccount.fetch(userAccount);
  console.log("8. system_balance after partial withdraw", userAfterPartialWithdraw.systemBalance.toString());

  console.log("9. total withdraw");
  await program.methods
    .withdraw(withdrawTotal)
    .accounts({
      config,
      vault,
      userAccount,
      owner: user,
      systemProgram: SystemProgram.programId
    })
    .rpc();

  const userAfterTotalWithdraw = await program.account.userAccount.fetch(userAccount);
  console.log("10. system_balance after total withdraw", userAfterTotalWithdraw.systemBalance.toString());

  console.log("11. withdraw without balance should fail");
  try {
    await program.methods
      .withdraw(new anchor.BN(1))
      .accounts({
        config,
        vault,
        userAccount,
        owner: user,
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
