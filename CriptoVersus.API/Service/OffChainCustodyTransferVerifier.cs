using System.Net.Http.Json;
using System.Text.Json;
using BLL.Blockchain;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

public interface IOffChainCustodyTransferVerifier
{
    Task<OffChainCustodyTransferVerificationResult> VerifyAsync(
        string signature,
        string expectedSourceWallet,
        string expectedDestinationWallet,
        long expectedLamports,
        CancellationToken ct = default);
}

public sealed class OffChainCustodyTransferVerifier : IOffChainCustodyTransferVerifier
{
    private readonly HttpClient _httpClient;
    private readonly CriptoVersusBlockchainOptions _options;
    private readonly ILogger<OffChainCustodyTransferVerifier> _logger;

    public OffChainCustodyTransferVerifier(
        HttpClient httpClient,
        IOptions<CriptoVersusBlockchainOptions> options,
        ILogger<OffChainCustodyTransferVerifier> logger)
    {
        _httpClient = httpClient;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<OffChainCustodyTransferVerificationResult> VerifyAsync(
        string signature,
        string expectedSourceWallet,
        string expectedDestinationWallet,
        long expectedLamports,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(signature))
            return OffChainCustodyTransferVerificationResult.Fail("Assinatura da transferencia nao informada.");

        if (string.IsNullOrWhiteSpace(expectedSourceWallet))
            return OffChainCustodyTransferVerificationResult.Fail("Wallet de origem nao informada.");

        if (string.IsNullOrWhiteSpace(expectedDestinationWallet))
            return OffChainCustodyTransferVerificationResult.Fail("Wallet de custodia nao configurada.");

        if (expectedLamports <= 0)
            return OffChainCustodyTransferVerificationResult.Fail("Valor esperado da transferencia invalido.");

        if (string.IsNullOrWhiteSpace(_options.RpcUrl))
            return OffChainCustodyTransferVerificationResult.Fail("RpcUrl nao configurada para validacao off-chain.");

        var requestBody = new
        {
            jsonrpc = "2.0",
            id = 1,
            method = "getTransaction",
            @params = new object[]
            {
                signature,
                new
                {
                    encoding = "jsonParsed",
                    commitment = "confirmed",
                    maxSupportedTransactionVersion = 0
                }
            }
        };

        using var response = await _httpClient.PostAsJsonAsync(_options.RpcUrl, requestBody, ct);
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning(
                "OffChain custody verification RPC failed. Status={StatusCode} Signature={Signature}",
                response.StatusCode,
                signature);

            return OffChainCustodyTransferVerificationResult.Fail("Nao foi possivel validar a transferencia na rede Solana.");
        }

        using var document = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        var root = document.RootElement;

        if (root.TryGetProperty("error", out var errorElement))
        {
            _logger.LogWarning(
                "OffChain custody verification RPC returned error. Signature={Signature} Error={Error}",
                signature,
                errorElement.ToString());

            return OffChainCustodyTransferVerificationResult.Fail("RPC Solana retornou erro ao validar a transferencia.");
        }

        if (!root.TryGetProperty("result", out var resultElement) || resultElement.ValueKind == JsonValueKind.Null)
            return OffChainCustodyTransferVerificationResult.Fail("Transacao nao encontrada na rede Solana.");

        if (resultElement.TryGetProperty("meta", out var metaElement)
            && metaElement.TryGetProperty("err", out var txErrorElement)
            && txErrorElement.ValueKind != JsonValueKind.Null)
        {
            return OffChainCustodyTransferVerificationResult.Fail("A transacao Solana informada falhou e nao pode financiar a aposta.");
        }

        if (!resultElement.TryGetProperty("transaction", out var transactionElement)
            || !transactionElement.TryGetProperty("message", out var messageElement)
            || !messageElement.TryGetProperty("instructions", out var instructionsElement)
            || instructionsElement.ValueKind != JsonValueKind.Array)
        {
            return OffChainCustodyTransferVerificationResult.Fail("Formato da transacao Solana invalido para verificacao.");
        }

        foreach (var instruction in instructionsElement.EnumerateArray())
        {
            if (!instruction.TryGetProperty("program", out var programElement)
                || !string.Equals(programElement.GetString(), "system", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (!instruction.TryGetProperty("parsed", out var parsedElement)
                || !parsedElement.TryGetProperty("type", out var typeElement)
                || !string.Equals(typeElement.GetString(), "transfer", StringComparison.OrdinalIgnoreCase)
                || !parsedElement.TryGetProperty("info", out var infoElement))
            {
                continue;
            }

            var source = infoElement.TryGetProperty("source", out var sourceElement)
                ? sourceElement.GetString()
                : null;
            var destination = infoElement.TryGetProperty("destination", out var destinationElement)
                ? destinationElement.GetString()
                : null;

            long lamports;
            if (!infoElement.TryGetProperty("lamports", out var lamportsElement))
                continue;

            if (lamportsElement.ValueKind == JsonValueKind.String)
            {
                if (!long.TryParse(lamportsElement.GetString(), out lamports))
                    continue;
            }
            else if (lamportsElement.ValueKind == JsonValueKind.Number)
            {
                if (!lamportsElement.TryGetInt64(out lamports))
                    continue;
            }
            else
            {
                continue;
            }

            if (!string.Equals(source, expectedSourceWallet, StringComparison.Ordinal)
                || !string.Equals(destination, expectedDestinationWallet, StringComparison.Ordinal)
                || lamports != expectedLamports)
            {
                continue;
            }

            return OffChainCustodyTransferVerificationResult.Success(source!, destination!, lamports);
        }

        return OffChainCustodyTransferVerificationResult.Fail(
            "A assinatura informada nao corresponde a uma transferencia valida da wallet do usuario para a carteira de custodia pelo valor esperado.");
    }
}

public sealed record OffChainCustodyTransferVerificationResult(
    bool Succeeded,
    string Message,
    string? SourceWallet = null,
    string? DestinationWallet = null,
    long? Lamports = null)
{
    public static OffChainCustodyTransferVerificationResult Success(string sourceWallet, string destinationWallet, long lamports)
        => new(true, "Transferencia off-chain validada com sucesso.", sourceWallet, destinationWallet, lamports);

    public static OffChainCustodyTransferVerificationResult Fail(string message)
        => new(false, message);
}
