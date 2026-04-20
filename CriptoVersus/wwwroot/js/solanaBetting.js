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

function i64Le(value) {
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    view.setBigInt64(0, BigInt(value), true);
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
        throw new Error("Valor do investimento inválido.");
    }

    return BigInt(Math.round(normalized * lamportsPerSol));
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

async function createMatchIfAllowed(options, context) {
    const {
        PublicKey,
        Transaction,
        TransactionInstruction,
        SystemProgram
    } = context.web3;

    if (!options.autoCreateMatch) {
        return null;
    }

    const authorityPublicKey = options.authorityPublicKey || "";
    if (!authorityPublicKey || context.provider.publicKey.toBase58() !== authorityPublicKey) {
        return null;
    }

    const teamAId = Number(options.teamAId);
    const teamBId = Number(options.teamBId);

    if (!Number.isInteger(teamAId) || !Number.isInteger(teamBId) || teamAId <= 0 || teamBId <= 0) {
        throw new Error("ONCHAIN_CREATE_MATCH_INVALID_TEAMS: TeamAId/TeamBId inválidos para criar a partida on-chain.");
    }

    const bettingCloseUnix = BigInt(
        options.bettingCloseUnix
            ? Math.floor(Number(options.bettingCloseUnix))
            : Math.floor(Date.now() / 1000) + (24 * 60 * 60));

    const [config] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("config")],
        context.programId);

    const data = concatBytes(
        await discriminator("create_match"),
        u64Le(context.matchId),
        new Uint8Array([teamAId]),
        new Uint8Array([teamBId]),
        i64Le(bettingCloseUnix));

    const instruction = new TransactionInstruction({
        programId: context.programId,
        keys: [
            { pubkey: config, isSigner: false, isWritable: false },
            { pubkey: context.matchAccount, isSigner: false, isWritable: true },
            { pubkey: context.vault, isSigner: false, isWritable: true },
            { pubkey: context.provider.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        data
    });

    const transaction = new Transaction().add(instruction);
    return await sendAndConfirm(context.connection, context.provider, transaction);
}

export async function placeBet(options) {
    return await depositPosition(options);
}

export async function depositPosition(options) {
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

    const programId = new PublicKey(options.programId);
    const cluster = options.cluster || "devnet";
    const connection = new Connection(clusterApiUrl(cluster), "confirmed");
    const teamId = Number(options.teamId);
    const amountLamports = solToLamports(options.amountSol, LAMPORTS_PER_SOL);

    if (!Number.isInteger(teamId) || teamId <= 0 || teamId > 255) {
        throw new Error("TeamId invalido para posicao on-chain.");
    }

    const teamSeed = new Uint8Array([teamId]);
    const [positionAccount] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("position"), provider.publicKey.toBuffer(), teamSeed],
        programId);

    const [positionVault] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("position_vault"), positionAccount.toBuffer()],
        programId);

    const positionInfo = await connection.getAccountInfo(positionAccount, "confirmed");
    const instructionName = positionInfo ? "deposit_position" : "create_position";
    const data = positionInfo
        ? concatBytes(
            await discriminator("deposit_position"),
            u64Le(amountLamports))
        : concatBytes(
            await discriminator("create_position"),
            teamSeed,
            u64Le(amountLamports));

    const instruction = new TransactionInstruction({
        programId,
        keys: [
            { pubkey: positionAccount, isSigner: false, isWritable: true },
            { pubkey: positionVault, isSigner: false, isWritable: true },
            { pubkey: provider.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        data
    });

    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirm(connection, provider, transaction);

    return {
        signature,
        instruction: instructionName,
        positionAccount: positionAccount.toBase58(),
        positionVault: positionVault.toBase58(),
        amountLamports: amountLamports.toString()
    };
}

export async function placeLegacyMatchBet(options) {
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

    const matchInfo = await connection.getAccountInfo(matchAccount, "confirmed");
    let createMatchSignature = null;

    if (!matchInfo) {
        createMatchSignature = await createMatchIfAllowed(options, {
            web3,
            connection,
            provider,
            programId,
            matchId,
            matchAccount,
            vault
        });

        if (!createMatchSignature) {
            const expectedAuthority = options.authorityPublicKey || "(não configurada)";
            const connectedWallet = provider.publicKey.toBase58();

            throw new Error(
                `ONCHAIN_MATCH_NOT_INITIALIZED: Match #${options.matchId} ainda nao foi criado na ${cluster}. ` +
                `Conecte a carteira authority on-chain para criar a partida com createMatch. ` +
                `Carteira conectada: ${connectedWallet}. Authority esperada: ${expectedAuthority}. ` +
                `Match PDA esperado: ${matchAccount.toBase58()}`);
        }
    }

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

    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirm(connection, provider, transaction);

    return {
        signature,
        createMatchSignature,
        matchAccount: matchAccount.toBase58(),
        betAccount: bet.toBase58(),
        vault: vault.toBase58(),
        amountLamports: amountLamports.toString()
    };
}
