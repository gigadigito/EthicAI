function getWeb3() {
    if (!window.solanaWeb3) {
        throw new Error("solana-web3 nao foi carregado.");
    }

    return window.solanaWeb3;
}

function getWalletInterop() {
    if (!window.criptoVersusWallet) {
        throw new Error("solanaWalletInterop nao foi carregado.");
    }

    return window.criptoVersusWallet;
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

export async function getConnectedWalletBalanceLamports(options) {
    const walletInterop = getWalletInterop();
    const lamports = await walletInterop.getConnectedWalletBalanceLamports(options || {});
    return lamports.toString();
}

export async function getConnectedWalletBalanceSol(options) {
    const walletInterop = getWalletInterop();
    return await walletInterop.getConnectedWalletBalanceSol(options || {});
}

export async function validateWalletHasEnoughSol(requiredSol, options) {
    const walletInterop = getWalletInterop();
    return await walletInterop.validateWalletHasEnoughSol(requiredSol, options || {});
}

export async function getMaxSpendableSol(options) {
    const walletInterop = getWalletInterop();
    return await walletInterop.getMaxSpendableSol(options || {});
}
