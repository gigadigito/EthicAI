function getProvider() {
    const provider = window.solana;

    if (!provider?.isPhantom) {
        throw new Error("Phantom não encontrada.");
    }

    return provider;
}

function getWeb3() {
    if (!window.solanaWeb3) {
        throw new Error("solana-web3 não foi carregado.");
    }

    return window.solanaWeb3;
}

function u64Le(value) {
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    view.setBigUint64(0, BigInt(value), true);
    return bytes;
}

async function discriminator(name) {
    const encoded = new TextEncoder().encode(`global:${name}`);
    const hash = await crypto.subtle.digest("SHA-256", encoded);
    return new Uint8Array(hash).slice(0, 8);
}

function concatBytes(...parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;

    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }

    return result;
}

function solToLamports(amountSol, lamportsPerSol) {
    const normalized = Number(amountSol);

    if (!Number.isFinite(normalized) || normalized <= 0) {
        throw new Error("Valor da aposta inválido.");
    }

    return BigInt(Math.round(normalized * lamportsPerSol));
}

export async function placeBet(options) {
    const {
        Connection,
        PublicKey,
        Transaction,
        TransactionInstruction,
        SystemProgram,
        clusterApiUrl,
        LAMPORTS_PER_SOL
    } = getWeb3();

    const provider = getProvider();

    if (!provider.isConnected) {
        await provider.connect();
    }

    const programId = new PublicKey(options.programId);
    const cluster = options.cluster || "devnet";
    const connection = new Connection(clusterApiUrl(cluster), "confirmed");
    const matchId = BigInt(options.matchId);
    const teamId = Number(options.teamId);
    const amountLamports = solToLamports(options.amountSol, LAMPORTS_PER_SOL);

    const matchSeed = u64Le(matchId);
    const [matchAccount] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("match"), matchSeed],
        programId);

    const [vault] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("vault"), matchAccount.toBuffer()],
        programId);

    const [bet] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("bet"), matchAccount.toBuffer(), provider.publicKey.toBuffer()],
        programId);

    const data = concatBytes(
        await discriminator("place_bet"),
        u64Le(matchId),
        new Uint8Array([teamId]),
        u64Le(amountLamports));

    const instruction = new TransactionInstruction({
        programId,
        keys: [
            { pubkey: matchAccount, isSigner: false, isWritable: true },
            { pubkey: vault, isSigner: false, isWritable: true },
            { pubkey: bet, isSigner: false, isWritable: true },
            { pubkey: provider.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        data
    });

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({
        feePayer: provider.publicKey,
        recentBlockhash: blockhash
    }).add(instruction);

    const signed = await provider.signTransaction(transaction);
    const signature = await connection.sendRawTransaction(signed.serialize());

    await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight
    }, "confirmed");

    return {
        signature,
        matchAccount: matchAccount.toBase58(),
        betAccount: bet.toBase58(),
        vault: vault.toBase58(),
        amountLamports: amountLamports.toString()
    };
}
