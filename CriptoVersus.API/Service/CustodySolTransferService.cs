using BLL.Blockchain;
using Microsoft.Extensions.Options;
using Solnet.Programs;
using Solnet.Rpc;
using Solnet.Rpc.Builders;
using Solnet.Rpc.Core.Http;
using Solnet.Wallet;
using SolanaPublicKey = Solnet.Wallet.PublicKey;

namespace CriptoVersus.API.Services;

public interface ICustodySolTransferService
{
    Task<string> TransferAsync(string destinationWallet, decimal amount, CancellationToken ct = default);
}

public sealed class CustodySolTransferService : ICustodySolTransferService
{
    private readonly IConfiguration _configuration;
    private readonly CriptoVersusBlockchainOptions _options;
    private readonly ILogger<CustodySolTransferService> _logger;

    public CustodySolTransferService(
        IConfiguration configuration,
        IOptions<CriptoVersusBlockchainOptions> options,
        ILogger<CustodySolTransferService> logger)
    {
        _configuration = configuration;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<string> TransferAsync(string destinationWallet, decimal amount, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(destinationWallet))
            throw new InvalidOperationException("Wallet de destino nao informada.");

        var secretKeyValue = _configuration["CriptoVersusBlockchain:CustodyWalletSecretKeyBase64"]
            ?? _configuration["SOLANA_SECRET_KEY"]
            ?? Environment.GetEnvironmentVariable("SOLANA_SECRET_KEY");

        if (string.IsNullOrWhiteSpace(secretKeyValue))
            throw new InvalidOperationException("CustodyWalletSecretKeyBase64/SOLANA_SECRET_KEY nao configurada para o saque real.");

        var rpcUrl = string.IsNullOrWhiteSpace(_options.RpcUrl)
            ? "https://api.devnet.solana.com"
            : _options.RpcUrl;

        var lamports = (ulong)Math.Round(amount * 1_000_000_000m, 0, MidpointRounding.ToZero);
        var wallet = new Wallet(Convert.FromBase64String(secretKeyValue));
        var rpcClient = ClientFactory.GetClient(rpcUrl);

        var blockhash = await rpcClient.GetRecentBlockHashAsync();
        if (!blockhash.WasSuccessful || blockhash.Result?.Value is null)
            throw new InvalidOperationException($"Falha ao obter blockhash para saque: {blockhash.Reason}");

        var tx = new TransactionBuilder()
            .SetRecentBlockHash(blockhash.Result.Value.Blockhash)
            .SetFeePayer(wallet.Account)
            .AddInstruction(SystemProgram.Transfer(
                wallet.Account.PublicKey,
                new SolanaPublicKey(destinationWallet),
                lamports))
            .Build(wallet.Account);

        var sendResult = await rpcClient.SendTransactionAsync(tx);
        if (!sendResult.WasSuccessful || string.IsNullOrWhiteSpace(sendResult.Result))
            throw new InvalidOperationException($"Falha ao enviar saque para a rede Solana: {sendResult.Reason}");

        _logger.LogInformation(
            "[CRYPTO_WITHDRAW][API] custody transfer submitted. Cluster={Cluster} Destination={Destination} Amount={Amount} Signature={Signature}",
            _options.Cluster,
            destinationWallet,
            amount,
            sendResult.Result);

        return sendResult.Result;
    }
}
