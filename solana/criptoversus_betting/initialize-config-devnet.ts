import * as anchor from "@coral-xyz/anchor";

console.log("======================================");
console.log("CriptoVersus Betting - Initialize Config");
console.log("Rede alvo: DEVNET");
console.log("======================================");

const DEVNET_RPC = "https://api.devnet.solana.com";

// Troque pelo novo Program ID gerado no deploy com a carteira Ggb.
const PROGRAM_ID = "4Ck537z1KEw1Azn9EHMvrW6xUhXGCUhDpSBJh6j5xjSX";

const EXPECTED_AUTHORITY = "GgbL9aYEAcZycbqFnJ8jnBxYEwu3jn8L2Ss8UbrN31Sc";

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
      name: "initializeConfig",
      accounts: [
        { name: "config", isMut: true, isSigner: false },
        { name: "authority", isMut: true, isSigner: true },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [],
    },
  ],
};

const program = new anchor.Program(idl as anchor.Idl, programId, provider);

async function main() {
  const authority = wallet.publicKey;
  const authorityBase58 = authority.toBase58();

  console.log("RPC endpoint:", connection.rpcEndpoint);
  console.log("Program ID:", program.programId.toBase58());
  console.log("Authority usada:", authorityBase58);
  console.log("Authority esperada:", EXPECTED_AUTHORITY);

  if (authorityBase58 !== EXPECTED_AUTHORITY) {
    throw new Error(
      `Wallet errada no Playground. Conectada=${authorityBase58}, esperada=${EXPECTED_AUTHORITY}`
    );
  }

  const [configPda, configBump] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  console.log("Config PDA:", configPda.toBase58(), "bump:", configBump);

  const existingConfig = await connection.getAccountInfo(configPda, "confirmed");
  if (existingConfig) {
    console.log("RESULTADO: config ja existe on-chain para este programa.");
    console.log(
      "Explorer DEVNET:",
      `https://explorer.solana.com/address/${configPda.toBase58()}?cluster=devnet`
    );
    return;
  }

  console.log("Enviando initializeConfig para DEVNET...");

  const tx = await program.methods
    .initializeConfig()
    .accounts({
      config: configPda,
      authority,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log("initialize_config tx:", tx);
  console.log(
    "Explorer DEVNET:",
    `https://explorer.solana.com/tx/${tx}?cluster=devnet`
  );
  console.log("initialize_config finalizado com sucesso na DEVNET.");
}

main().catch((err) => {
  console.error("--------------------------------------");
  console.error("Erro ao executar initialize_config na DEVNET");
  console.error("--------------------------------------");
  console.error("Program ID usado:", programId.toBase58());
  console.error("RPC endpoint:", connection.rpcEndpoint);
  console.error("Erro:", err);

  if (`${err}`.includes("already in use")) {
    console.error("Diagnostico: essa config ja existe on-chain.");
  }
});
