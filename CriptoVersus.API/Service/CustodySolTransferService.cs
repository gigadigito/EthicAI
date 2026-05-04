using BLL.Blockchain;
using Microsoft.Extensions.Options;
using System.Numerics;
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
//TESTE
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
        var privateKeyBytes = NormalizePrivateKey(ParseSecretKey(secretKeyValue));
        var custodyPublicKey = new SolanaPublicKey(_options.CustodyWalletPublicKey);
        var account = new Account(privateKeyBytes, custodyPublicKey.KeyBytes);
        var rpcClient = ClientFactory.GetClient(rpcUrl);

        var blockhash = await rpcClient.GetLatestBlockHashAsync();
        if (!blockhash.WasSuccessful || blockhash.Result?.Value is null)
            throw new InvalidOperationException($"Falha ao obter blockhash para saque: {blockhash.Reason}");

        var tx = new TransactionBuilder()
            .SetRecentBlockHash(blockhash.Result.Value.Blockhash)
            .SetFeePayer(account)
            .AddInstruction(SystemProgram.Transfer(
                account.PublicKey,
                new SolanaPublicKey(destinationWallet),
                lamports))
            .Build(account);

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

    private static byte[] ParseSecretKey(string secretKeyValue)
    {
        var normalizedValue = secretKeyValue.Trim().Trim('"');
        var base58Candidate = TryDecodeBase58(normalizedValue);
        if (base58Candidate is not null && IsExpectedSecretKeyLength(base58Candidate.Length))
            return base58Candidate;

        try
        {
            var base64Candidate = Convert.FromBase64String(normalizedValue);
            if (IsExpectedSecretKeyLength(base64Candidate.Length))
                return base64Candidate;

            if (base58Candidate is not null)
                return base58Candidate;

            return base64Candidate;
        }
        catch (FormatException)
        {
            if (base58Candidate is not null)
                return base58Candidate;

            throw new InvalidOperationException("A chave da custodia nao esta em base64 nem base58 validos.");
        }
    }

    private static byte[] NormalizePrivateKey(byte[] keyBytes)
    {
        if (keyBytes.Length == 32)
            return keyBytes;

        if (keyBytes.Length == 64)
            return keyBytes;

        throw new InvalidOperationException($"A chave da custodia precisa ter 32 ou 64 bytes apos decodificacao. Tamanho recebido: {keyBytes.Length}.");
    }

    private static byte[] Base58Decode(string value)
    {
        const string alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
        var intData = BigInteger.Zero;

        foreach (var c in value.Trim())
        {
            var digit = alphabet.IndexOf(c);
            if (digit < 0)
                throw new InvalidOperationException("A chave da custodia nao esta em base64 nem base58 validos.");

            intData = intData * 58 + digit;
        }

        var bytes = intData.ToByteArray(isUnsigned: true, isBigEndian: true);
        var leadingZeroCount = value.TakeWhile(ch => ch == '1').Count();

        if (leadingZeroCount == 0)
            return bytes;

        var result = new byte[leadingZeroCount + bytes.Length];
        bytes.CopyTo(result, leadingZeroCount);
        return result;
    }

    private static byte[]? TryDecodeBase58(string value)
    {
        try
        {
            return Base58Decode(value);
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }

    private static bool IsExpectedSecretKeyLength(int length)
        => length is 32 or 64;
}
