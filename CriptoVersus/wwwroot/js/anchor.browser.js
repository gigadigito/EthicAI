// anchor.browser.js
window.anchor = (() => {
    const web3 = solanaWeb3;

    class AnchorProvider {
        constructor(connection, wallet, opts) {
            this.connection = connection;
            this.wallet = wallet;
            this.opts = opts;
        }

        static defaultOptions() {
            return {
                preflightCommitment: "processed",
                commitment: "processed"
            };
        }
    }

    class Program {
        constructor(idl, programId, provider) {
            this.idl = idl;
            this.programId = programId;
            this.provider = provider;
        }

        methods = {
            claim: () => {
                return {
                    accounts: (accs) => {
                        this._accs = accs;
                        return this;
                    },
                    rpc: async () => {
                        const tx = new web3.Transaction();
                        const keys = [
                            { pubkey: this._accs.user, isSigner: true, isWritable: true },
                            { pubkey: this._accs.program, isSigner: false, isWritable: true },
                            { pubkey: this._accs.bet, isSigner: false, isWritable: true }
                        ];
                        const instruction = new web3.TransactionInstruction({
                            keys,
                            programId: this.programId,
                            data: Buffer.from([0]) // método 0 = claim
                        });
                        tx.add(instruction);
                        tx.feePayer = this.provider.wallet.publicKey;
                        tx.recentBlockhash = (await this.provider.connection.getRecentBlockhash()).blockhash;
                        const signed = await this.provider.wallet.signTransaction(tx);
                        const txid = await this.provider.connection.sendRawTransaction(signed.serialize());
                        return txid;
                    }
                };
            }
        };
    }

    return {
        web3,
        AnchorProvider,
        Program
    };
})();
