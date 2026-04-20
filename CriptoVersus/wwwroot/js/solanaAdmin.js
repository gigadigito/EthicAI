function getWeb3() {
    if (!window.solanaWeb3) {
        throw new Error("solana-web3 nao foi carregado.");
    }

    return window.solanaWeb3;
}

function sol(lamports, lamportsPerSol) {
    return Number(lamports) / lamportsPerSol;
}

export async function getProgramOverview(options) {
    const web3 = getWeb3();
    const {
        Connection,
        PublicKey,
        clusterApiUrl,
        LAMPORTS_PER_SOL
    } = web3;

    const programId = new PublicKey(options.programId);
    const cluster = options.cluster || "devnet";
    const connection = new Connection(clusterApiUrl(cluster), "confirmed");

    const [configPda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("config")],
        programId);

    const [programBalance, configBalance, programAccounts] = await Promise.all([
        connection.getBalance(programId, "confirmed"),
        connection.getBalance(configPda, "confirmed"),
        connection.getProgramAccounts(programId, "confirmed")
    ]);

    const ownedAccountsLamports = programAccounts.reduce(
        (sum, item) => sum + BigInt(item.account.lamports),
        0n);

    return {
        cluster,
        programId: programId.toBase58(),
        configPda: configPda.toBase58(),
        programBalanceSol: sol(programBalance, LAMPORTS_PER_SOL),
        configBalanceSol: sol(configBalance, LAMPORTS_PER_SOL),
        ownedAccounts: programAccounts.length,
        ownedAccountsSol: sol(ownedAccountsLamports, LAMPORTS_PER_SOL)
    };
}
