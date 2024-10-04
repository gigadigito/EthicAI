async function sendSolTransaction(destinationPublicKey, amount) {
    try {
        const {
            Connection,
            clusterApiUrl,
            PublicKey,
            Transaction,
            SystemProgram,
            LAMPORTS_PER_SOL
        } = window.solanaWeb3;

        const connection = new Connection(clusterApiUrl('testnet'));
        const connection = new Connection(clusterApiUrl('testnet'));
        const wallet = window.solana;

        // Solicita conexão com a carteira se não estiver conectada
        if (!wallet.isConnected) {
            await wallet.connect();
        }

        // Converte o valor para lamports
        const lamports = amount * LAMPORTS_PER_SOL;

        // Cria a transação
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: wallet.publicKey,
                toPubkey: new PublicKey(destinationPublicKey),
                lamports: lamports,
            })
        );

        // Configura o blockhash recente e o fee payer
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = wallet.publicKey;

        // Assina e envia a transação
        const signedTransaction = await wallet.signTransaction(transaction);
        const signature = await connection.sendRawTransaction(signedTransaction.serialize());

        // Confirma a transação
        await connection.confirmTransaction(signature);

        return signature;
    } catch (error) {
        console.error('Transaction error:', error);

        // Exibe uma mensagem amigável para erros relacionados ao saldo
        if (error.message.includes('Attempt to debit an account but found no record of a prior credit')) {
            alert('Insufficient balance to complete the transaction. Please add funds and try again.');
        } else {
            alert('An error occurred while processing the transaction. Please try again.');
        }

        throw error;
    }
}
