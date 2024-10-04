// SolanaService.cs

using System;
using System.Threading.Tasks;
using Solnet.Rpc;
using Solnet.Rpc.Models;
using Solnet.Wallet;
using Solnet.Rpc.Builders;
using Solnet.Rpc.Types;
using Solnet.Programs;
using Solnet.Programs.Models;
using Microsoft.Extensions.Configuration;

// Definindo alias para evitar ambiguidade
using SolanaPublicKey = Solnet.Wallet.PublicKey;

namespace EthicAI.Business
{
    public class SolanaService
    {
        private readonly IRpcClient _rpcClient;
        private readonly Wallet _wallet;

        // Definindo uma constante para conversão de SOL para lamports
        private const decimal SolToLamports = 1000000000m;

        public SolanaService(IConfiguration configuration)
        {
            // Conectar-se à Testnet
            _rpcClient = ClientFactory.GetClient(Cluster.TestNet);

            // Obter a chave secreta de uma variável de ambiente
            var secretKeyString = configuration["SOLANA_SECRET_KEY"];
            if (string.IsNullOrEmpty(secretKeyString))
            {
                throw new Exception("A chave secreta Solana não está definida.");
            }

            try
            {
                // Supondo que a chave secreta esteja codificada em Base64
                var secretKey = Convert.FromBase64String(secretKeyString);
                _wallet = new Wallet(secretKey);
            }
            catch (FormatException)
            {
                throw new Exception("A chave secreta Solana fornecida não está no formato correto.");
            }
        }

        // Obter o saldo de SOL de uma conta
        public async Task<ulong> GetBalanceAsync(string publicKey)
        {
            var result = await _rpcClient.GetBalanceAsync(publicKey);
            if (result.WasSuccessful)
            {
                return result.Result.Value;
            }
            else
            {
                throw new Exception($"Erro ao obter saldo: {result.Reason}");
            }
        }

        // Enviar uma transação de SOL
        public async Task<string> SendSolAsync(string destination, decimal amountSol)
        {
            // Validar entrada
            if (string.IsNullOrEmpty(destination))
            {
                throw new ArgumentException("A carteira de destino não pode ser vazia.", nameof(destination));
            }

            if (amountSol <= 0)
            {
                throw new ArgumentException("A quantidade de SOL deve ser maior que zero.", nameof(amountSol));
            }

            // Converter SOL para lamports
            ulong lamports = (ulong)(amountSol * SolToLamports);

            // Construir a transação
            var txBuilder = new TransactionBuilder()
                .SetRecentBlockHash(await GetRecentBlockHashAsync())
                .SetFeePayer(_wallet.Account) // Passando Solnet.Wallet.Account
                .AddInstruction(SystemProgram.Transfer(
                    _wallet.Account.PublicKey,
                    new SolanaPublicKey(destination),
                    lamports));

            var transaction = txBuilder.Build(_wallet.Account); // Passando Solnet.Wallet.Account

            // Serializar a transação (retorna byte[])
            byte[] serializedTransaction = transaction;

            // Enviar a transação
            var txSignature = await _rpcClient.SendTransactionAsync(serializedTransaction);

            if (txSignature.WasSuccessful)
            {
                return txSignature.Result;
            }
            else
            {
                throw new Exception($"Erro ao enviar transação: {txSignature.Reason}");
            }
        }

        // Obter o blockhash recente
        private async Task<string> GetRecentBlockHashAsync()
        {
            var blockhashResponse = await _rpcClient.GetRecentBlockHashAsync();
            if (blockhashResponse.WasSuccessful)
            {
                return blockhashResponse.Result.Value.Blockhash;
            }
            else
            {
                throw new Exception($"Erro ao obter blockhash: {blockhashResponse.Reason}");
            }
        }
    }
}
