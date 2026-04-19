function getWeb3() {
    if (!window.solanaWeb3) {
        throw new Error("solana-web3 nao foi carregado.");
    }

    return window.solanaWeb3;
}

export async function getSolBalance(publicKey, cluster) {
    if (!publicKey) {
        throw new Error("Carteira nao informada.");
    }

    const {
        Connection,
        PublicKey,
        clusterApiUrl,
        LAMPORTS_PER_SOL
    } = getWeb3();

    const network = cluster || "devnet";
    const connection = new Connection(clusterApiUrl(network), "confirmed");
    const lamports = await connection.getBalance(new PublicKey(publicKey), "confirmed");

    return lamports / LAMPORTS_PER_SOL;
}
