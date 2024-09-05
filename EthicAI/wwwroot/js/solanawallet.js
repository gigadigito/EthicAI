window.solanaLogin = async function () {
    if (window.solana && window.solana.isPhantom) {
        try {
            // Forçar a desconexão, se a carteira já estiver conectada
            await window.solana.disconnect();

            // Solicitar a conexão novamente
            const response = await window.solana.connect();
            const publicKey = response.publicKey.toString();

            // Mensagem a ser assinada
            const message = 'Login with Solana';
            const encodedMessage = new TextEncoder().encode(message);

            // Solicita a assinatura da mensagem
            const { signature } = await window.solana.request({
                method: 'signMessage',
                params: {
                    message: encodedMessage,
                    display: 'utf8',
                },
            });

            return {
                publicKey: publicKey,
                signature: signature
            };
        } catch (err) {
            console.error('Erro ao conectar com a Solana:', err);
            return null;
        }
    } else {
        console.log('Phantom Wallet não foi encontrada.');
        return null;
    }
};
