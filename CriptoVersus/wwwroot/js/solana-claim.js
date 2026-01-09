window.ethicaiClaim = async function () {
    const connection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl("devnet"));
    const wallet = window.solana;

    // Solicita conexão com a carteira
    await wallet.connect();

    const programId = new solanaWeb3.PublicKey("BngkhvKSiTTWmwaViXJ1oX8xhNgZKmkxTnmscyBRBZxq");
    const userPubkey = wallet.publicKey;

    // Deriva o endereço da conta de aposta usando seeds
    const [betAccount] = solanaWeb3.PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("bet"), userPubkey.toBuffer()],
        programId
    );

    // Verifica se a conta existe no Devnet
    const accountInfo = await connection.getAccountInfo(betAccount);
    if (!accountInfo) {
        throw new Error("A conta de aposta (betAccount) não existe. Você precisa apostar antes de fazer o claim.");
    }

    // Discriminador correto para a instrução "claim"
    const claimDiscriminator = [99, 158, 51, 118, 221, 243, 203, 174];

    // Cria a instrução
    const instruction = new solanaWeb3.TransactionInstruction({
        keys: [
            { pubkey: userPubkey, isSigner: true, isWritable: true },
            { pubkey: programId, isSigner: false, isWritable: true },
            { pubkey: betAccount, isSigner: false, isWritable: true }
        ],
        programId: programId,
        data: Buffer.from(claimDiscriminator)
    });

    const transaction = new solanaWeb3.Transaction().add(instruction);
    transaction.feePayer = userPubkey;
    transaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;

    // Solicita assinatura da transação pela carteira
    const signedTransaction = await wallet.signTransaction(transaction);

    // Envia a transação para a Devnet
    const txId = await connection.sendRawTransaction(signedTransaction.serialize());

    return txId;
};
