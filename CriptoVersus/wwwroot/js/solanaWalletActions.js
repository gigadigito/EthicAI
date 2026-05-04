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

function logLogin(message, ...args) {
    console.log(`[CRYPTOLOGIN] ${message}`, ...args);
}

function warnLogin(message, ...args) {
    console.warn(`[CRYPTOLOGIN] ${message}`, ...args);
}

function errorLogin(message, ...args) {
    console.error(`[CRYPTOLOGIN][ERRO] ${message}`, ...args);
}

function logWithdraw(message, ...args) {
    console.log(`[CRYPTO_WITHDRAW] ${message}`, ...args);
}

function warnWithdraw(message, ...args) {
    console.warn(`[CRYPTO_WITHDRAW] ${message}`, ...args);
}

function errorWithdraw(message, ...args) {
    console.error(`[CRYPTO_WITHDRAW][ERRO] ${message}`, ...args);
}

function bytesToBase64(bytes) {
    const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = "";
    for (const byte of array) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary);
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

function readU64Le(bytes, offset) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return view.getBigUint64(offset, true);
}

function readI64Le(bytes, offset) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return view.getBigInt64(offset, true);
}

function lamportsToSolString(lamports, decimals = 9) {
    const value = typeof lamports === "bigint" ? lamports : BigInt(lamports);
    const divisor = 10n ** BigInt(decimals);
    const integer = value / divisor;
    const fraction = value % divisor;
    const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
    return fractionText ? `${integer}.${fractionText}` : integer.toString();
}

function decodeUserAccount(data, PublicKey) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const minimumLength = 8 + 32 + 8 + 8 + 8 + 8 + 8 + 1;

    if (bytes.length < minimumLength) {
        throw new Error(`UserAccount com tamanho invalido: ${bytes.length} bytes.`);
    }

    const owner = new PublicKey(bytes.slice(8, 40)).toBase58();
    const systemBalanceLamports = readU64Le(bytes, 40);
    const totalClaimedLamports = readU64Le(bytes, 48);
    const totalWithdrawnLamports = readU64Le(bytes, 56);
    const createdAtUnix = readI64Le(bytes, 64);
    const updatedAtUnix = readI64Le(bytes, 72);
    const bump = bytes[80];

    return {
        owner,
        systemBalanceLamports,
        totalClaimedLamports,
        totalWithdrawnLamports,
        createdAtUnix,
        updatedAtUnix,
        bump
    };
}

export async function ensureUserOnchainAccount(options) {
    const web3 = getWeb3();
    const {
        Connection,
        PublicKey,
        Transaction,
        TransactionInstruction,
        SystemProgram,
        clusterApiUrl
    } = web3;

    const provider = getProvider();
    if (!provider.isConnected) {
        await provider.connect();
    }

    const cluster = options.cluster || "devnet";
    const programId = new PublicKey(options.programId);
    const connection = new Connection(clusterApiUrl(cluster), "confirmed");

    logLogin("Wallet conectada:", provider.publicKey.toBase58());
    logLogin("Cluster:", cluster);
    logLogin("Program ID:", programId.toBase58());

    const [userAccount] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("user"), provider.publicKey.toBuffer()],
        programId
    );

    logLogin("UserAccount PDA:", userAccount.toBase58());

    try {
        let accountInfo = await connection.getAccountInfo(userAccount, "confirmed");
        logLogin("UserAccount encontrada?", accountInfo !== null);

        let created = false;
        let initSignature = null;

        if (!accountInfo) {
            warnLogin("UserAccount nao encontrada. Iniciando init_user_account...");

            const instruction = new TransactionInstruction({
                programId,
                keys: [
                    { pubkey: userAccount, isSigner: false, isWritable: true },
                    { pubkey: provider.publicKey, isSigner: true, isWritable: true },
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
                ],
                data: await discriminator("init_user_account")
            });

            const transaction = new Transaction().add(instruction);
            initSignature = await sendAndConfirm(connection, provider, transaction);
            created = true;

            logLogin("init_user_account tx:", initSignature);
            logLogin("Aguardando confirmacao...");
            logLogin("init confirmado com sucesso.");
            logLogin("Reconsultando UserAccount...");

            accountInfo = await connection.getAccountInfo(userAccount, "confirmed");
            logLogin("UserAccount encontrada apos init?", accountInfo !== null);
        }

        if (!accountInfo) {
            throw new Error("UserAccount continua ausente apos tentativa de init_user_account.");
        }

        const decoded = decodeUserAccount(accountInfo.data, PublicKey);
        logLogin("system_balance:", `${lamportsToSolString(decoded.systemBalanceLamports)} SOL`);
        logLogin("total_claimed:", `${lamportsToSolString(decoded.totalClaimedLamports)} SOL`);
        logLogin("total_withdrawn:", `${lamportsToSolString(decoded.totalWithdrawnLamports)} SOL`);

        return {
            wallet: provider.publicKey.toBase58(),
            cluster,
            programId: programId.toBase58(),
            userAccountPda: userAccount.toBase58(),
            exists: true,
            created,
            initSignature,
            systemBalanceLamports: decoded.systemBalanceLamports.toString(),
            totalClaimedLamports: decoded.totalClaimedLamports.toString(),
            totalWithdrawnLamports: decoded.totalWithdrawnLamports.toString()
        };
    } catch (error) {
        errorLogin("motivo completo", error);
        throw error;
    }
}

export async function claimAvailableReturns(options) {
    throw new Error("O resgate de retornos agora e processado pelo backend. Atualize a tela e tente novamente.");
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
    const cluster = options.cluster || "devnet";
    const mode = options.mode || "HybridContractCustody";
    const expectedWallet = options.expectedWallet || null;
    const amountSol = Number(options.amountSol);
    const destinationWallet = expectedWallet || null;

    if (!provider.isConnected) {
        warnWithdraw("wallet nao conectada. solicitando conexao...");
        await provider.connect();
    }

    if (!provider.publicKey) {
        throw new Error("wallet nao conectada");
    }

    const connectedWallet = provider.publicKey.toBase58();
    logWithdraw("wallet conectada", true);
    logWithdraw("publicKey", connectedWallet);
    logWithdraw("cluster", cluster);
    logWithdraw("valor solicitado", `${amountSol} SOL`);
    logWithdraw("destino", destinationWallet);

    if (!Number.isFinite(amountSol) || amountSol <= 0) {
        throw new Error("Valor de saque invalido.");
    }

    if (expectedWallet && connectedWallet !== expectedWallet) {
        throw new Error("carteira diferente da conta");
    }

    if (mode === "OffChainCustody") {
        if (typeof provider.signMessage !== "function") {
            throw new Error("wallet sem suporte a assinatura de mensagem");
        }

        const proofMessage =
            `CriptoVersus withdraw authorization\nwallet:${connectedWallet}\namount:${amountSol}\ncluster:${cluster}\nts:${Date.now()}`;
        const encodedMessage = new TextEncoder().encode(proofMessage);
        const signedMessage = await provider.signMessage(encodedMessage, "utf8");
        const proofSignature = bytesToBase64(signedMessage.signature || signedMessage);
        logWithdraw("assinatura de autorizacao gerada", true);

        return {
            connectedWallet,
            cluster,
            mode,
            supported: true,
            signature: null,
            proofMessage,
            proofSignature,
            confirmationStatus: "wallet-signed"
        };
    }

    if (mode !== "HybridContractCustody") {
        warnWithdraw(`modo ${mode} nao suporta withdraw on-chain automatico.`);
        return {
            connectedWallet,
            cluster,
            mode,
            supported: false,
            signature: null,
            confirmationStatus: "unsupported"
        };
    }

    const amountLamports = BigInt(Math.round(amountSol * LAMPORTS_PER_SOL));
    const programId = new PublicKey(options.programId);
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

    const existingUserAccount = await connection.getAccountInfo(userAccount, "confirmed");
    if (!existingUserAccount) {
        warnWithdraw("UserAccount encontrada?", false);
        throw new Error("UserAccount nao inicializada para esta wallet. Conclua o onboarding on-chain antes do saque.");
    }

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
    logWithdraw("signature", signature);

    const confirmation = await connection.getSignatureStatus(signature, {
        searchTransactionHistory: true
    });
    const confirmationStatus = confirmation?.value?.confirmationStatus || "confirmed";
    logWithdraw("confirmacao RPC", confirmationStatus);

    return {
        connectedWallet,
        cluster,
        mode,
        supported: true,
        signature,
        proofMessage: null,
        proofSignature: null,
        confirmationStatus,
        amountLamports: amountLamports.toString(),
        userAccount: userAccount.toBase58(),
        vault: vault.toBase58()
    };
}
