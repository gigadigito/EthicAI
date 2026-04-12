// solanaWallet.js

let provider = null;

// Detecta Phantom
function getProvider() {
    if ("solana" in window) {
        const anyWindow = window;
        if (anyWindow.solana?.isPhantom) {
            return anyWindow.solana;
        }
    }

    throw new Error("Phantom não encontrado. Instale a extensão.");
}

// Conectar carteira
export async function connect() {
    provider = getProvider();

    const resp = await provider.connect();

    return {
        connected: true,
        publicKey: resp.publicKey.toString()
    };
}

// Desconectar
export async function disconnect() {
    if (provider) {
        await provider.disconnect();
    }

    provider = null;

    return {
        connected: false
    };
}

// Ver se está conectado
export function isConnected() {
    return provider?.isConnected || false;
}

// Pegar public key
export function getPublicKey() {
    return provider?.publicKey?.toString() || null;
}

// Assinar mensagem (LOGIN)
export async function signMessage(message) {
    if (!provider || !provider.isConnected) {
        throw new Error("Carteira não conectada.");
    }

    const encodedMessage = new TextEncoder().encode(message);

    const signed = await provider.signMessage(encodedMessage, "utf8");

    return {
        publicKey: provider.publicKey.toString(),
        message: message,
        signature: toBase64(signed.signature)
    };
}

// Helper base64
function toBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);

    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }

    return btoa(binary);
}