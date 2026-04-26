import * as anchor from "@coral-xyz/anchor";

console.log("======================================");
console.log("CriptoVersus Betting - Credit User Balance");
console.log("Rede alvo: DEVNET");
console.log("======================================");

const DEVNET_RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = "4Ck537z1KEw1Azn9EHMvrW6xUhXGCUhDpSBJh6j5xjSX";

const TARGET_USER_WALLET = "REPLACE_WITH_USER_WALLET";
const SETTLEMENT_ID = "settlement-001";
const AMOUNT_LAMPORTS = 1_350_000_000;

const connection = new anchor.web3.Connection(DEVNET_RPC, "confirmed");
const wallet = pg.wallet;

if (!wallet) {
  throw new Error("Wallet do Playground nao encontrada. Rode connect antes.");
}

const provider = new anchor.AnchorProvider(connection, wallet, {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});

anchor.setProvider(provider);

const programId = new anchor.web3.PublicKey(PROGRAM_ID);

const idl = {
  version: "0.1.0",
  name: "criptoversus_betting",
  instructions: [
    {
      name: "creditUserBalance",
      accounts: [
        { name: "config", isMut: false, isSigner: false },
        { name: "userAccount", isMut: true, isSigner: false },
        { name: "userWallet", isMut: false, isSigner: false },
        { name: "receipt", isMut: true, isSigner: false },
        { name: "authority", isMut: true, isSigner: true },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "amount", type: "u64" },
        { name: "settlementId", type: "string" },
      ],
    },
  ],
};

const program = new anchor.Program(idl as anchor.Idl, programId, provider);

async function main() {
  if (TARGET_USER_WALLET === "REPLACE_WITH_USER_WALLET") {
    throw new Error("Defina TARGET_USER_WALLET antes de rodar o script.");
  }

  const authority = wallet.publicKey;
  const userWallet = new anchor.web3.PublicKey(TARGET_USER_WALLET);
  const [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const [userAccountPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("user"), userWallet.toBuffer()],
    program.programId
  );
  const [receiptPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), userWallet.toBuffer(), Buffer.from(SETTLEMENT_ID)],
    program.programId
  );

  console.log("RPC endpoint:", connection.rpcEndpoint);
  console.log("Program ID:", program.programId.toBase58());
  console.log("Authority:", authority.toBase58());
  console.log("Target user:", userWallet.toBase58());
  console.log("Settlement ID:", SETTLEMENT_ID);
  console.log("Amount lamports:", AMOUNT_LAMPORTS.toString());
  console.log("Config PDA:", configPda.toBase58());
  console.log("UserAccount PDA:", userAccountPda.toBase58());
  console.log("Receipt PDA:", receiptPda.toBase58());

  const existingReceipt = await connection.getAccountInfo(receiptPda, "confirmed");
  if (existingReceipt) {
    console.log("RESULTADO: esse settlement_id ja foi creditado on-chain.");
    console.log(
      "Explorer DEVNET:",
      `https://explorer.solana.com/address/${receiptPda.toBase58()}?cluster=devnet`
    );
    return;
  }

  console.log("Enviando creditUserBalance para DEVNET...");

  const tx = await program.methods
    .creditUserBalance(new anchor.BN(AMOUNT_LAMPORTS), SETTLEMENT_ID)
    .accounts({
      config: configPda,
      userAccount: userAccountPda,
      userWallet,
      receipt: receiptPda,
      authority,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log("credit_user_balance tx:", tx);
  console.log(
    "Explorer DEVNET:",
    `https://explorer.solana.com/tx/${tx}?cluster=devnet`
  );
  console.log("credit_user_balance finalizado com sucesso na DEVNET.");
}

main().catch((err) => {
  console.error("--------------------------------------");
  console.error("Erro ao executar credit_user_balance na DEVNET");
  console.error("--------------------------------------");
  console.error("Program ID usado:", programId.toBase58());
  console.error("RPC endpoint:", connection.rpcEndpoint);
  console.error("Erro:", err);
});
