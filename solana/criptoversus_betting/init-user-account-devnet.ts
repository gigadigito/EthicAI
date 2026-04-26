import * as anchor from "@coral-xyz/anchor";

console.log("======================================");
console.log("CriptoVersus Betting - Init User Account");
console.log("Rede alvo: DEVNET");
console.log("======================================");

const DEVNET_RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = "4Ck537z1KEw1Azn9EHMvrW6xUhXGCUhDpSBJh6j5xjSX";

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
      name: "initUserAccount",
      accounts: [
        { name: "userAccount", isMut: true, isSigner: false },
        { name: "owner", isMut: true, isSigner: true },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [],
    },
  ],
};

const program = new anchor.Program(idl as anchor.Idl, programId, provider);

async function main() {
  const owner = wallet.publicKey;
  const [userAccountPda, userBump] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("user"), owner.toBuffer()],
    program.programId
  );

  console.log("RPC endpoint:", connection.rpcEndpoint);
  console.log("Program ID:", program.programId.toBase58());
  console.log("Owner:", owner.toBase58());
  console.log("UserAccount PDA:", userAccountPda.toBase58(), "bump:", userBump);

  const existingUserAccount = await connection.getAccountInfo(userAccountPda, "confirmed");
  if (existingUserAccount) {
    console.log("RESULTADO: user_account ja existe on-chain para esta wallet.");
    console.log(
      "Explorer DEVNET:",
      `https://explorer.solana.com/address/${userAccountPda.toBase58()}?cluster=devnet`
    );
    return;
  }

  console.log("Enviando initUserAccount para DEVNET...");

  const tx = await program.methods
    .initUserAccount()
    .accounts({
      userAccount: userAccountPda,
      owner,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log("init_user_account tx:", tx);
  console.log(
    "Explorer DEVNET:",
    `https://explorer.solana.com/tx/${tx}?cluster=devnet`
  );
  console.log("init_user_account finalizado com sucesso na DEVNET.");
}

main().catch((err) => {
  console.error("--------------------------------------");
  console.error("Erro ao executar init_user_account na DEVNET");
  console.error("--------------------------------------");
  console.error("Program ID usado:", programId.toBase58());
  console.error("RPC endpoint:", connection.rpcEndpoint);
  console.error("Erro:", err);
});
