(function () {
    const DEFAULT_SOL_FEE_BUFFER = 0.00001;
    const wallets = [
        {
            name: "Phantom",
            installUrl: "https://phantom.app/",
            getProvider: () => window.phantom?.solana ?? (window.solana?.isPhantom ? window.solana : null)
        },
        {
            name: "Solflare",
            installUrl: "https://solflare.com/",
            getProvider: () => window.solflare ?? (window.solana?.isSolflare ? window.solana : null)
        },
        {
            name: "Backpack",
            installUrl: "https://backpack.app/",
            getProvider: () => window.backpack ?? (window.solana?.isBackpack ? window.solana : null)
        },
        {
            name: "Glow",
            installUrl: "https://glow.app/",
            getProvider: () => window.glowSolana ?? (window.solana?.isGlow ? window.solana : null)
        },
        {
            name: "Coinbase Wallet",
            installUrl: "https://www.coinbase.com/wallet/downloads",
            getProvider: () => window.coinbaseSolana ?? (window.solana?.isCoinbaseWallet ? window.solana : null)
        }
    ];

    let activeProvider = null;
    let activeWalletName = null;

    function resolveWallet(walletName) {
        return wallets.find(wallet => wallet.name.toLowerCase() === String(walletName || "").toLowerCase()) ?? null;
    }

    function readProviderPublicKey(provider) {
        if (!provider?.publicKey) {
            return null;
        }

        if (typeof provider.publicKey.toBase58 === "function") {
            return provider.publicKey.toBase58();
        }

        if (typeof provider.publicKey.toString === "function") {
            return provider.publicKey.toString();
        }

        return null;
    }

    function getProviderFlags(provider) {
        return {
            isPhantom: !!provider?.isPhantom,
            isSolflare: !!provider?.isSolflare,
            isBackpack: !!provider?.isBackpack
        };
    }

    function logProviderDiag(payload) {
        console.log("[WALLET_PROVIDER_DIAG]", payload);
    }

    function toFriendlyError(error, fallbackMessage) {
        if (!error) {
            return fallbackMessage;
        }

        const message = typeof error === "string"
            ? error
            : error.message || error.toString?.() || fallbackMessage;

        if (/user rejected|user denied|rejected the request|cancelled|canceled|declined/i.test(message)
            || error?.code === 4001) {
            return "Connection request was canceled.";
        }

        if (/not found|not installed|provider/i.test(message)) {
            return "Wallet provider not found in this browser.";
        }

        return fallbackMessage || message;
    }

    function getWeb3() {
        if (!window.solanaWeb3) {
            throw new Error("solana-web3 nao foi carregado.");
        }

        return window.solanaWeb3;
    }

    function inferLocale(options) {
        const explicitLocale = typeof options?.locale === "string" ? options.locale.trim() : "";
        if (explicitLocale) {
            return explicitLocale;
        }

        const documentLocale = typeof document?.documentElement?.lang === "string"
            ? document.documentElement.lang.trim()
            : "";

        return documentLocale || "en-US";
    }

    function isPortugueseLocale(locale) {
        return String(locale || "").toLowerCase().startsWith("pt");
    }

    function clampLamports(value) {
        return value > 0n ? value : 0n;
    }

    function normalizeSolString(value) {
        if (typeof value === "number") {
            if (!Number.isFinite(value)) {
                throw new Error("Valor SOL invalido.");
            }

            value = value.toString();
        }

        const normalized = String(value ?? "")
            .trim()
            .replace(",", ".");

        if (!normalized || normalized === ".") {
            throw new Error("Valor SOL invalido.");
        }

        if (!/^\d+(\.\d+)?$/.test(normalized)) {
            throw new Error("Valor SOL invalido.");
        }

        return normalized;
    }

    function solToLamportsSafe(value) {
        const normalized = normalizeSolString(value);
        const [wholePart, fractionPart = ""] = normalized.split(".");
        const wholeLamports = BigInt(wholePart || "0") * 1000000000n;
        const paddedFraction = (fractionPart + "000000000").slice(0, 9);
        const fractionLamports = BigInt(paddedFraction || "0");

        return wholeLamports + fractionLamports;
    }

    function lamportsToSol(lamports) {
        const value = typeof lamports === "bigint" ? lamports : BigInt(lamports ?? 0);
        const whole = value / 1000000000n;
        const fraction = value % 1000000000n;
        const fractionText = fraction.toString().padStart(9, "0").replace(/0+$/, "");
        const text = fractionText ? `${whole}.${fractionText}` : whole.toString();
        return Number(text);
    }

    function formatSolValue(sol, locale) {
        return new Intl.NumberFormat(isPortugueseLocale(locale) ? "pt-BR" : "en-US", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 8
        }).format(Math.max(0, Number(sol || 0)));
    }

    function getWalletGuardMessage(code, maxSpendableSol, locale) {
        const formattedAmount = formatSolValue(maxSpendableSol, locale);

        if (code === "WALLET_NOT_CONNECTED") {
            return isPortugueseLocale(locale)
                ? "Conecte sua carteira para validar o saldo disponível."
                : "Connect your wallet to validate the available balance.";
        }

        if (code === "INSUFFICIENT_BALANCE") {
            return isPortugueseLocale(locale)
                ? `Saldo insuficiente na carteira. Voce possui ${formattedAmount} SOL disponivel para esta operacao.`
                : `Insufficient wallet balance. You have ${formattedAmount} SOL available for this operation.`;
        }

        if (code === "RPC_URL_MISSING") {
            return isPortugueseLocale(locale)
                ? "RPC da Solana nao configurada para validar saldo."
                : "Solana RPC is not configured for balance validation.";
        }

        return isPortugueseLocale(locale)
            ? "Nao foi possivel validar o saldo da carteira agora."
            : "Could not validate the wallet balance right now.";
    }

    function resolveRpcUrl(options) {
        const candidate = typeof options?.rpcUrl === "string"
            ? options.rpcUrl.trim()
            : typeof window.ethicaiBlockchainConfig?.rpcUrl === "string"
                ? window.ethicaiBlockchainConfig.rpcUrl.trim()
                : "";

        if (!candidate) {
            throw new Error("RPC_URL_MISSING");
        }

        return candidate;
    }

    async function ensureProviderForBalance(provider) {
        if (!provider) {
            throw new Error("WALLET_NOT_CONNECTED");
        }

        if (!provider.isConnected || !readProviderPublicKey(provider)) {
            await ensureConnectedProvider(provider);
        }

        if (!readProviderPublicKey(provider)) {
            throw new Error("WALLET_NOT_CONNECTED");
        }

        return provider;
    }

    async function getConnectedWalletBalanceLamports(options = {}) {
        const { Connection, PublicKey } = getWeb3();
        const provider = await ensureProviderForBalance(activeProvider);
        const rpcUrl = resolveRpcUrl(options);
        const connection = new Connection(rpcUrl, "confirmed");
        const publicKey = new PublicKey(readProviderPublicKey(provider));
        const lamports = await connection.getBalance(publicKey, "confirmed");
        return BigInt(lamports);
    }

    async function getConnectedWalletBalanceSol(options = {}) {
        const lamports = await getConnectedWalletBalanceLamports(options);
        return lamportsToSol(lamports);
    }

    async function getMaxSpendableSol(options = {}) {
        const locale = inferLocale(options);
        const feeBufferLamports = clampLamports(solToLamportsSafe(options.feeBufferSol ?? DEFAULT_SOL_FEE_BUFFER));

        try {
            const wallet = readProviderPublicKey(activeProvider);
            const balanceLamports = await getConnectedWalletBalanceLamports(options);
            const maxSpendableLamports = clampLamports(balanceLamports - feeBufferLamports);
            const balanceSol = lamportsToSol(balanceLamports);
            const maxSpendableSol = lamportsToSol(maxSpendableLamports);

            return {
                ok: true,
                code: "OK",
                wallet,
                balanceLamports: balanceLamports.toString(),
                balanceSol,
                feeBuffer: lamportsToSol(feeBufferLamports),
                feeBufferLamports: feeBufferLamports.toString(),
                maxSpendableLamports: maxSpendableLamports.toString(),
                maxSpendableSol,
                requiredSol: 0,
                requiredLamports: "0",
                message: ""
            };
        } catch (error) {
            const code = error?.message === "WALLET_NOT_CONNECTED" || error?.message === "RPC_URL_MISSING"
                ? error.message
                : "BALANCE_LOOKUP_FAILED";

            return {
                ok: false,
                code,
                wallet: readProviderPublicKey(activeProvider),
                balanceLamports: "0",
                balanceSol: 0,
                feeBuffer: lamportsToSol(feeBufferLamports),
                feeBufferLamports: feeBufferLamports.toString(),
                maxSpendableLamports: "0",
                maxSpendableSol: 0,
                requiredSol: 0,
                requiredLamports: "0",
                message: getWalletGuardMessage(code, 0, locale)
            };
        }
    }

    async function validateWalletHasEnoughSol(requiredSol, options = {}) {
        const locale = inferLocale(options);
        const flowName = options.flowName || "UNKNOWN_FLOW";
        const feeBufferLamports = clampLamports(solToLamportsSafe(options.feeBufferSol ?? DEFAULT_SOL_FEE_BUFFER));
        const requiredLamports = clampLamports(solToLamportsSafe(requiredSol ?? 0));
        const totalRequiredLamports = requiredLamports + feeBufferLamports;

        try {
            const wallet = readProviderPublicKey(activeProvider);
            const balanceLamports = await getConnectedWalletBalanceLamports(options);
            const maxSpendableLamports = clampLamports(balanceLamports - feeBufferLamports);
            const ok = balanceLamports >= totalRequiredLamports;
            const balanceSol = lamportsToSol(balanceLamports);
            const maxSpendableSol = lamportsToSol(maxSpendableLamports);
            const feeBuffer = lamportsToSol(feeBufferLamports);

            const result = {
                ok,
                code: ok ? "OK" : "INSUFFICIENT_BALANCE",
                wallet,
                balanceLamports: balanceLamports.toString(),
                balanceSol,
                requiredLamports: requiredLamports.toString(),
                requiredSol: lamportsToSol(requiredLamports),
                feeBufferLamports: feeBufferLamports.toString(),
                feeBuffer,
                maxSpendableLamports: maxSpendableLamports.toString(),
                maxSpendableSol,
                message: ok ? "" : getWalletGuardMessage("INSUFFICIENT_BALANCE", maxSpendableSol, locale)
            };

            if (!ok) {
                console.warn("[WALLET_BALANCE_GUARD_BLOCKED]", {
                    wallet,
                    requiredSol: result.requiredSol,
                    balanceSol,
                    feeBuffer,
                    maxSpendableSol,
                    flowName
                });
            }

            return result;
        } catch (error) {
            const code = error?.message === "WALLET_NOT_CONNECTED" || error?.message === "RPC_URL_MISSING"
                ? error.message
                : "BALANCE_LOOKUP_FAILED";
            const result = {
                ok: false,
                code,
                wallet: readProviderPublicKey(activeProvider),
                balanceLamports: "0",
                balanceSol: 0,
                requiredLamports: requiredLamports.toString(),
                requiredSol: lamportsToSol(requiredLamports),
                feeBufferLamports: feeBufferLamports.toString(),
                feeBuffer: lamportsToSol(feeBufferLamports),
                maxSpendableLamports: "0",
                maxSpendableSol: 0,
                message: getWalletGuardMessage(code, 0, locale)
            };

            console.warn("[WALLET_BALANCE_GUARD_BLOCKED]", {
                wallet: result.wallet,
                requiredSol: result.requiredSol,
                balanceSol: result.balanceSol,
                feeBuffer: result.feeBuffer,
                maxSpendableSol: result.maxSpendableSol,
                flowName
            });

            return result;
        }
    }

    function bytesToBase64(bytes) {
        const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        let binary = "";

        for (const byte of array) {
            binary += String.fromCharCode(byte);
        }

        return btoa(binary);
    }

    async function ensureConnectedProvider(provider) {
        if (!provider || typeof provider.connect !== "function") {
            throw new Error("Wallet provider not found in this browser.");
        }

        if (provider.isConnected && readProviderPublicKey(provider)) {
            return {
                publicKey: readProviderPublicKey(provider)
            };
        }

        return provider.connect();
    }

    function detectWallets() {
        return wallets.map(wallet => ({
            name: wallet.name,
            detected: !!wallet.getProvider(),
            installUrl: wallet.installUrl
        }));
    }

    async function connect(walletName) {
        const wallet = resolveWallet(walletName);
        if (!wallet) {
            return {
                success: false,
                walletName: walletName || "",
                error: "Unsupported wallet."
            };
        }

        const provider = wallet.getProvider();
        if (!provider || typeof provider.connect !== "function") {
            return {
                success: false,
                walletName: wallet.name,
                error: "Wallet provider not found in this browser."
            };
        }

        try {
            const response = await ensureConnectedProvider(provider);
            const publicKey = response?.publicKey?.toString?.() ?? readProviderPublicKey(provider);

            if (!publicKey) {
                return {
                    success: false,
                    walletName: wallet.name,
                    error: "Connected wallet did not return a public key."
                };
            }

            activeProvider = provider;
            activeWalletName = wallet.name;

            return {
                success: true,
                walletName: wallet.name,
                publicKey
            };
        } catch (error) {
            return {
                success: false,
                walletName: wallet.name,
                error: toFriendlyError(error, "Could not connect to this wallet right now.")
            };
        }
    }

    async function disconnect() {
        const provider = activeProvider;

        if (provider && typeof provider.disconnect === "function") {
            try {
                await provider.disconnect();
            } catch {
                // Ignore disconnect errors during local cleanup.
            }
        }

        activeProvider = null;
        activeWalletName = null;

        return {
            success: true
        };
    }

    async function signMessage(message) {
        const provider = activeProvider;

        if (!provider) {
            throw new Error("Wallet provider not found in this browser.");
        }

        if (!provider.isConnected) {
            await ensureConnectedProvider(provider);
        }

        if (typeof provider.signMessage !== "function") {
            throw new Error("This wallet does not support sign message in the current browser.");
        }

        const publicKey = readProviderPublicKey(provider);
        if (!publicKey) {
            throw new Error("Connected wallet did not return a public key.");
        }

        try {
            const encodedMessage = new TextEncoder().encode(message);
            const signed = await provider.signMessage(encodedMessage, "utf8");

            return {
                publicKey,
                message,
                signature: bytesToBase64(signed.signature)
            };
        } catch (error) {
            throw new Error(toFriendlyError(error, "Could not sign the login message."));
        }
    }

    function openInstall(walletName) {
        const wallet = resolveWallet(walletName);
        if (!wallet) {
            return false;
        }

        window.open(wallet.installUrl, "_blank", "noopener,noreferrer");
        return true;
    }

    function getActiveProvider() {
        return activeProvider;
    }

    function getActiveWalletName() {
        return activeWalletName;
    }

    function getPublicKey() {
        return readProviderPublicKey(activeProvider);
    }

    function getRequiredActiveProviderForTransaction(source) {
        const provider = activeProvider;
        const publicKey = readProviderPublicKey(provider);
        const walletName = activeWalletName;
        const flags = getProviderFlags(provider);

        if (!provider || typeof provider.connect !== "function" || !walletName || !publicKey) {
            logProviderDiag({
                source,
                resolution: "FALLBACK_BLOCKED",
                activeWalletName: walletName || null,
                publicKey: publicKey || null,
                ...flags
            });

            throw new Error("Selecione e conecte uma wallet antes de continuar.");
        }

        logProviderDiag({
            source,
            resolution: "ACTIVE_PROVIDER",
            activeWalletName: walletName,
            publicKey,
            ...flags
        });

        return provider;
    }

    window.criptoVersusWallet = {
        DEFAULT_SOL_FEE_BUFFER,
        detectWallets,
        connect,
        disconnect,
        signMessage,
        openInstall,
        getActiveProvider,
        getActiveWalletName,
        getPublicKey,
        getRequiredActiveProviderForTransaction,
        solToLamportsSafe,
        lamportsToSol,
        getConnectedWalletBalanceLamports,
        getConnectedWalletBalanceSol,
        validateWalletHasEnoughSol,
        getMaxSpendableSol
    };
})();
