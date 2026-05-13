(function () {
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
        detectWallets,
        connect,
        disconnect,
        signMessage,
        openInstall,
        getActiveProvider,
        getActiveWalletName,
        getPublicKey,
        getRequiredActiveProviderForTransaction
    };
})();
