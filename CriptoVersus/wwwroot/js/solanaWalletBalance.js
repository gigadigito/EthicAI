function getWeb3() {
    if (!window.solanaWeb3) {
        throw new Error("solana-web3 nao foi carregado.");
    }

    return window.solanaWeb3;
}

export async function getSolBalance(publicKey, cluster, rpcUrl) {
    if (!publicKey) {
        throw new Error("Carteira nao informada.");
    }

    const {
        Connection,
        PublicKey,
        LAMPORTS_PER_SOL
    } = getWeb3();

    const network = cluster || "devnet";
    const endpoint = typeof rpcUrl === "string" ? rpcUrl.trim() : "";
    if (!endpoint) {
        throw new Error(`RpcUrl nao configurada para consultar saldo em ${network}.`);
    }
    const connection = new Connection(endpoint, "confirmed");
    const lamports = await connection.getBalance(new PublicKey(publicKey), "confirmed");

    return lamports / LAMPORTS_PER_SOL;
}
