import * as anchor from "@coral-xyz/anchor";

console.log("======================================");
console.log("CriptoVersus Betting - Create Match");
console.log("Rede alvo: DEVNET");
console.log("======================================");

const DEVNET_RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = "4Ck537z1KEw1Azn9EHMvrW6xUhXGCUhDpSBJh6j5xjSX";

// Ajuste estes 3 campos conforme o card/partida do CriptoVersus.
const MATCH_ID = 1;
const TEAM_A_ID = 1;
const TEAM_B_ID = 2;

// Janela de investimento aberta por 24h a partir da execucao deste script.
const BETTING_CLOSE_SECONDS_FROM_NOW = 24 * 60 * 60;

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
      name: "createMatch",
      accounts: [
        { name: "config", isMut: false, isSigner: false },
        { name: "matchAccount", isMut: true, isSigner: false },
        { name: "vault", isMut: true, isSigner: false },
        { name: "authority", isMut: true, isSigner: true },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "matchId", type: "u64" },
        { name: "teamAId", type: "u8" },
        { name: "teamBId", type: "u8" },
        { name: "bettingCloseTs", type: "i64" },
      ],
    },
  ],
};

const program = new anchor.Program(idl as anchor.Idl, programId, provider);

function u64Le(value: anchor.BN): Buffer {
  return value.toArrayLike(Buffer, "le", 8);
}

async function main() {
  const authority = wallet.publicKey;
  const matchIdBn = new anchor.BN(MATCH_ID);
  const bettingCloseTs = new anchor.BN(
    Math.floor(Date.now() / 1000) + BETTING_CLOSE_SECONDS_FROM_NOW
  );

  console.log("RPC endpoint:", connection.rpcEndpoint);
  console.log("Authority:", authority.toBase58());
  console.log("Program ID:", program.programId.toBase58());
  console.log("Match ID:", MATCH_ID);
  console.log("Team A ID:", TEAM_A_ID);
  console.log("Team B ID:", TEAM_B_ID);
  console.log("Betting close unix:", bettingCloseTs.toString());

  const [configPda, configBump] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  const [matchPda, matchBump] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("match"), u64Le(matchIdBn)],
    program.programId
  );

  const [vaultPda, vaultBump] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), matchPda.toBuffer()],
    program.programId
  );

  console.log("Config PDA:", configPda.toBase58(), "bump:", configBump);
  console.log("Match PDA:", matchPda.toBase58(), "bump:", matchBump);
  console.log("Vault PDA:", vaultPda.toBase58(), "bump:", vaultBump);

  const existingMatch = await connection.getAccountInfo(matchPda, "confirmed");
  if (existingMatch) {
    console.log("RESULTADO: esta partida ja existe on-chain.");
    console.log(
      "Explorer DEVNET:",
      `https://explorer.solana.com/address/${matchPda.toBase58()}?cluster=devnet`
    );
    return;
  }

  console.log("Enviando createMatch para DEVNET...");

  const tx = await program.methods
    .createMatch(matchIdBn, TEAM_A_ID, TEAM_B_ID, bettingCloseTs)
    .accounts({
      config: configPda,
      matchAccount: matchPda,
      vault: vaultPda,
      authority,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log("create_match tx:", tx);
  console.log(
    "Explorer DEVNET:",
    `https://explorer.solana.com/tx/${tx}?cluster=devnet`
  );
  console.log("create_match finalizado com sucesso na DEVNET.");
}

main().catch((err) => {
  console.error("--------------------------------------");
  console.error("Erro ao executar create_match na DEVNET");
  console.error("--------------------------------------");
  console.error("Program ID usado:", programId.toBase58());
  console.error("RPC endpoint:", connection.rpcEndpoint);
  console.error("Erro:", err);

  if (`${err}`.includes("Unauthorized")) {
    console.error(
      "Diagnostico: use a mesma wallet que executou initialize_config, ou troque a autoridade do contrato."
    );
  }
});
