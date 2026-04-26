function getProvider() {
    const provider = window.solana;

    if (!provider?.isPhantom) {
        throw new Error("Phantom nao encontrada.");
    }

    return provider;
}

function getWeb3() {
    if (!window.solanaWeb3) {
        throw new Error("solana-web3 nao foi carregado.");
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

async function sendAndConfirm(connection, provider, transaction) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    transaction.feePayer = provider.publicKey;
    transaction.recentBlockhash = blockhash;

    const signed = await provider.signTransaction(transaction);
    const signature = await connection.sendRawTransaction(signed.serialize());

    await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight
    }, "confirmed");

    return signature;
}

export async function claimAvailableReturns(options) {
    const web3 = getWeb3();
    const {
        Connection,
        PublicKey,
        Transaction,
        TransactionInstruction,
        clusterApiUrl
    } = web3;

    const provider = getProvider();
    if (!provider.isConnected) {
        await provider.connect();
    }

    const programId = new PublicKey(options.programId);
    const cluster = options.cluster || "devnet";
    const connection = new Connection(clusterApiUrl(cluster), "confirmed");
    const claimableBets = Array.isArray(options.claimableBets) ? options.claimableBets : [];

    if (claimableBets.length === 0) {
        throw new Error("Nao ha bets claimaveis para resgatar.");
    }

    const [userAccount] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("user"), provider.publicKey.toBuffer()],
        programId);

    const claimDiscriminator = await discriminator("claim");
    const signatures = [];

    for (const entry of claimableBets) {
        const matchId = BigInt(entry.matchId);
        const matchSeed = u64Le(matchId);

        const [matchAccount] = PublicKey.findProgramAddressSync(
            [new TextEncoder().encode("match"), matchSeed],
            programId);

        const [bet] = PublicKey.findProgramAddressSync(
            [new TextEncoder().encode("bet"), matchAccount.toBuffer(), provider.publicKey.toBuffer()],
            programId);

        const instruction = new TransactionInstruction({
            programId,
            keys: [
                { pubkey: matchAccount, isSigner: false, isWritable: false },
                { pubkey: userAccount, isSigner: false, isWritable: true },
                { pubkey: bet, isSigner: false, isWritable: true },
                { pubkey: provider.publicKey, isSigner: true, isWritable: true }
            ],
            data: claimDiscriminator
        });

        const transaction = new Transaction().add(instruction);
        const signature = await sendAndConfirm(connection, provider, transaction);
        signatures.push(signature);
    }

    return {
        signatures,
        userAccount: userAccount.toBase58()
    };
}

export async function withdrawSystemBalance(options) {
    const web3 = getWeb3();
    const {
        Connection,
        PublicKey,
        Transaction,
        TransactionInstruction,
        SystemProgram,
        clusterApiUrl,
        LAMPORTS_PER_SOL
    } = web3;

    const provider = getProvider();
    if (!provider.isConnected) {
        await provider.connect();
    }

    const amountSol = Number(options.amountSol);
    if (!Number.isFinite(amountSol) || amountSol <= 0) {
        throw new Error("Valor de saque invalido.");
    }

    const amountLamports = BigInt(Math.round(amountSol * LAMPORTS_PER_SOL));
    const programId = new PublicKey(options.programId);
    const cluster = options.cluster || "devnet";
    const connection = new Connection(clusterApiUrl(cluster), "confirmed");

    const [config] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("config")],
        programId);

    const [vault] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("vault")],
        programId);

    const [userAccount] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("user"), provider.publicKey.toBuffer()],
        programId);

    const instruction = new TransactionInstruction({
        programId,
        keys: [
            { pubkey: config, isSigner: false, isWritable: false },
            { pubkey: vault, isSigner: false, isWritable: true },
            { pubkey: userAccount, isSigner: false, isWritable: true },
            { pubkey: provider.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        data: concatBytes(
            await discriminator("withdraw"),
            u64Le(amountLamports))
    });

    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirm(connection, provider, transaction);

    return {
        signature,
        amountLamports: amountLamports.toString(),
        userAccount: userAccount.toBase58(),
        vault: vault.toBase58()
    };
}
