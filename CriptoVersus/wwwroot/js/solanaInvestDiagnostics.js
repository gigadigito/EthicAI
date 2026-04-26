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

function logInvest(message, ...args) {
    console.log(`[CRYPTOINVEST] ${message}`, ...args);
}

function warnInvest(message, ...args) {
    console.warn(`[CRYPTOINVEST] ${message}`, ...args);
}

function errorInvest(stage, error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[CRYPTOINVEST][ERRO] etapa:", stage);
    console.error("[CRYPTOINVEST][ERRO] mensagem:", message);
    console.error("[CRYPTOINVEST][ERRO] logs da transacao, se existirem:", error?.logs ?? null);
    console.error("[CRYPTOINVEST][ERRO] stack completa:", error);
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

function readU64Le(bytes, offset) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return view.getBigUint64(offset, true);
}

function readI64Le(bytes, offset) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return view.getBigInt64(offset, true);
}

function solToLamports(amountSol, lamportsPerSol) {
    const normalized = Number(amountSol);

    if (!Number.isFinite(normalized) || normalized <= 0) {
        throw new Error("Valor do investimento invalido.");
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

async function ensureUserAccountExists(connection, provider, programId, SystemProgram, PublicKey, Transaction, TransactionInstruction) {
    const [userAccount] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("user"), provider.publicKey.toBuffer()],
        programId
    );

    logInvest("UserAccount PDA:", userAccount.toBase58());

    let userAccountInfo = await connection.getAccountInfo(userAccount, "confirmed");
    logInvest("UserAccount existe?", userAccountInfo !== null);

    let initSignature = null;

    if (!userAccountInfo) {
        warnInvest("UserAccount nao encontrada. Iniciando init_user_account...");

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
        logInvest("Transaction signature:", initSignature);
        logInvest("Confirmacao:", "confirmed");
        logInvest("Reconsultando UserAccount...");

        userAccountInfo = await connection.getAccountInfo(userAccount, "confirmed");
        logInvest("UserAccount encontrada apos init?", userAccountInfo !== null);
    }

    if (!userAccountInfo) {
        throw new Error("UserAccount continua ausente apos tentativa de init_user_account.");
    }

    const decoded = decodeUserAccount(userAccountInfo.data, PublicKey);
    logInvest("system_balance:", `${lamportsToSolString(decoded.systemBalanceLamports)} SOL`);
    logInvest("total_claimed:", `${lamportsToSolString(decoded.totalClaimedLamports)} SOL`);
    logInvest("total_withdrawn:", `${lamportsToSolString(decoded.totalWithdrawnLamports)} SOL`);

    return {
        userAccount,
        initSignature,
        decoded
    };
}

export async function prepareInvestment(options) {
    const stage = { current: "inicializacao" };

    try {
        stage.current = "carregando-web3";

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

        stage.current = "wallet";

        const provider = getProvider();
        if (!provider.isConnected) {
            await provider.connect();
        }

        const cluster = options.cluster || "devnet";
        const connection = new Connection(clusterApiUrl(cluster), "confirmed");
        const programId = new PublicKey(options.programId);
        const teamId = Number(options.teamId);
        const matchId = options.matchId ?? null;
        const amountLamports = solToLamports(options.amountSol, LAMPORTS_PER_SOL);
        const teamName = options.teamName || options.selectedCoin || `Team#${teamId}`;
        const supportsLegacyPositionInvestments = Boolean(options.supportsLegacyPositionInvestments);

        logInvest("Iniciando preparação de posição on-chain");
        logInvest("Wallet conectada:", provider.publicKey.toBase58());
        logInvest("Cluster:", cluster);
        logInvest("Program ID:", programId.toBase58());
        logInvest("Team/Coin selecionada:", teamName);
        logInvest("Team ID:", teamId);
        logInvest("Valor solicitado:", `${options.amountSol} SOL`);

        if (!Number.isInteger(teamId) || teamId <= 0) {
            throw new Error("Team ID invalido para investimento.");
        }

        stage.current = "user-account";

        const { userAccount, initSignature, decoded } = await ensureUserAccountExists(
            connection,
            provider,
            programId,
            SystemProgram,
            PublicKey,
            Transaction,
            TransactionInstruction
        );

        const [configPda] = PublicKey.findProgramAddressSync(
            [new TextEncoder().encode("config")],
            programId
        );

        const [vaultPda] = PublicKey.findProgramAddressSync(
            [new TextEncoder().encode("vault")],
            programId
        );

        logInvest("Config PDA:", configPda.toBase58());
        logInvest("Vault PDA:", vaultPda.toBase58());
        logInvest("Match ID, se aplicável:", matchId);

        const teamSeed = new Uint8Array([teamId]);
        const [legacyPositionPda] = PublicKey.findProgramAddressSync(
            [new TextEncoder().encode("position"), provider.publicKey.toBuffer(), teamSeed],
            programId
        );

        const [legacyPositionVaultPda] = PublicKey.findProgramAddressSync(
            [new TextEncoder().encode("position_vault"), legacyPositionPda.toBuffer()],
            programId
        );

        const legacyPositionInfo = await connection.getAccountInfo(legacyPositionPda, "confirmed");
        logInvest("Position PDA:", legacyPositionPda.toBase58());
        logInvest("Position existe?", legacyPositionInfo !== null);
        logInvest("Bet/Position account calculada, se aplicável:", legacyPositionPda.toBase58());

        let legacyMatchPda = null;
        let legacyBetPda = null;

        if (matchId !== null && matchId !== undefined) {
            const matchSeed = u64Le(BigInt(matchId));
            [legacyMatchPda] = PublicKey.findProgramAddressSync(
                [new TextEncoder().encode("match"), matchSeed],
                programId
            );

            [legacyBetPda] = PublicKey.findProgramAddressSync(
                [new TextEncoder().encode("bet"), legacyMatchPda.toBuffer(), provider.publicKey.toBuffer()],
                programId
            );

            logInvest("PDA antiga de Match calculada:", legacyMatchPda.toBase58());
            logInvest("PDA antiga de Bet calculada:", legacyBetPda.toBase58());
        }

        if (!supportsLegacyPositionInvestments) {
            warnInvest("Fluxo legado detectado. O contrato atual nao possui create_position, deposit_position, create_match ou place_bet.");
            logInvest("Instrução que será chamada:", "OFFCHAIN_ONLY");
            logInvest("Accounts enviados:", {
                config: configPda.toBase58(),
                vault: vaultPda.toBase58(),
                userAccount: userAccount.toBase58(),
                legacyPositionPda: legacyPositionPda.toBase58(),
                legacyPositionVaultPda: legacyPositionVaultPda.toBase58(),
                legacyMatchPda: legacyMatchPda?.toBase58() ?? null,
                legacyBetPda: legacyBetPda?.toBase58() ?? null
            });
            logInvest("Transaction signature:", null);
            logInvest("Confirmação:", "nenhuma - investimento segue off-chain");
            logInvest("Resultado final:", "Investimento será enviado apenas ao backend. O contrato atual permanece como onboarding, saldo consolidado, credit_user_balance e withdraw.");

            return {
                wallet: provider.publicKey.toBase58(),
                cluster,
                programId: programId.toBase58(),
                teamId,
                matchId,
                amountLamports: amountLamports.toString(),
                userAccountPda: userAccount.toBase58(),
                userAccountExists: true,
                configPda: configPda.toBase58(),
                vaultPda: vaultPda.toBase58(),
                positionPda: legacyPositionPda.toBase58(),
                positionExists: legacyPositionInfo !== null,
                legacyMatchPda: legacyMatchPda?.toBase58() ?? null,
                legacyBetPda: legacyBetPda?.toBase58() ?? null,
                instruction: "OFFCHAIN_ONLY",
                signature: null,
                confirmation: "SKIPPED",
                initSignature,
                systemBalanceLamports: decoded.systemBalanceLamports.toString(),
                totalClaimedLamports: decoded.totalClaimedLamports.toString(),
                totalWithdrawnLamports: decoded.totalWithdrawnLamports.toString(),
                result: "OFFCHAIN_BACKEND_ONLY"
            };
        }

        logInvest("Instrução que será chamada:", legacyPositionInfo ? "deposit_position" : "create_position");
        logInvest("Accounts enviados:", {
            positionAccount: legacyPositionPda.toBase58(),
            positionVault: legacyPositionVaultPda.toBase58(),
            owner: provider.publicKey.toBase58(),
            systemProgram: SystemProgram.programId.toBase58()
        });

        throw new Error("Fluxo legado ainda habilitado no frontend, mas o contrato atual simplificado nao deve usar investimento on-chain por position.");
    } catch (error) {
        errorInvest(stage.current, error);
        throw error;
    }
}
