using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BLL;
using BLL.Blockchain;
using DAL;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

public interface ISystemBalanceWithdrawalService
{
    Task<WalletActionResultDto> WithdrawAsync(
        User authenticatedUser,
        WithdrawSystemBalanceRequest request,
        CancellationToken ct = default);

    Task<AdminSystemBalanceWithdrawDiagnosticsDto> BuildDiagnosticsAsync(CancellationToken ct = default);
}

public interface IOnChainWithdrawalVerifier
{
    Task<OnChainWithdrawalVerificationResult> VerifyAsync(
        string signature,
        string expectedWallet,
        decimal expectedAmount,
        CancellationToken ct = default);
}

public sealed record OnChainWithdrawalVerificationResult(
    bool Succeeded,
    string Message,
    string Code,
    string? Cluster = null,
    string? DestinationWallet = null,
    long? Lamports = null)
{
    public static OnChainWithdrawalVerificationResult Success(
        string message,
        string? cluster,
        string? destinationWallet,
        long lamports)
        => new(true, message, "WITHDRAW_VERIFIED", cluster, destinationWallet, lamports);

    public static OnChainWithdrawalVerificationResult Failure(string code, string message)
        => new(false, message, code);
}

public sealed class SystemBalanceWithdrawalService : ISystemBalanceWithdrawalService
{
    internal const string PendingLedgerType = "WITHDRAW_REQ";
    internal const string FailedLedgerType = "WITHDRAW_FAIL";
    internal const string CompletedLedgerType = "SYSTEM_BALANCE_WITHDRAW";
    internal const string CancelledLedgerType = "WITHDRAW_CANCELLED";

    private readonly EthicAIDbContext _context;
    private readonly ILedgerService _ledgerService;
    private readonly IOnChainWithdrawalVerifier _withdrawalVerifier;
    private readonly ICustodySolTransferService _custodySolTransferService;
    private readonly CriptoVersusBlockchainOptions _blockchainOptions;
    private readonly ILogger<SystemBalanceWithdrawalService> _logger;

    public SystemBalanceWithdrawalService(
        EthicAIDbContext context,
        ILedgerService ledgerService,
        IOnChainWithdrawalVerifier withdrawalVerifier,
        ICustodySolTransferService custodySolTransferService,
        IOptions<CriptoVersusBlockchainOptions> blockchainOptions,
        ILogger<SystemBalanceWithdrawalService> logger)
    {
        _context = context;
        _ledgerService = ledgerService;
        _withdrawalVerifier = withdrawalVerifier;
        _custodySolTransferService = custodySolTransferService;
        _blockchainOptions = blockchainOptions.Value;
        _logger = logger;
    }

    public async Task<WalletActionResultDto> WithdrawAsync(
        User authenticatedUser,
        WithdrawSystemBalanceRequest request,
        CancellationToken ct = default)
    {
        var amount = RoundMoney(request.Amount);
        var connectedWallet = request.ConnectedWalletPublicKey?.Trim();
        var signature = request.OnChainSignature?.Trim();
        var requestMarker = !string.IsNullOrWhiteSpace(signature)
            ? signature
            : $"proof-{ComputeHash(request.WalletProofSignature ?? connectedWallet ?? authenticatedUser.Wallet)}";

        if (authenticatedUser is null)
            throw new WithdrawalFlowException(StatusCodes.Status401Unauthorized, "UNAUTHENTICATED", "Usuario autenticado nao encontrado.");

        if (amount <= 0m)
            throw new WithdrawalFlowException(StatusCodes.Status400BadRequest, "INSUFFICIENT_SYSTEM_BALANCE", "Saldo insuficiente.");

        if (string.IsNullOrWhiteSpace(connectedWallet))
            throw new WithdrawalFlowException(StatusCodes.Status400BadRequest, "WALLET_NOT_CONNECTED", "Wallet nao conectada.");

        if (!string.Equals(connectedWallet, authenticatedUser.Wallet, StringComparison.Ordinal))
            throw new WithdrawalFlowException(StatusCodes.Status400BadRequest, "WALLET_MISMATCH", "A carteira conectada e diferente da conta logada.");

        if (!_blockchainOptions.IsOnChainWithdrawalFlowEnabled())
        {
            throw new WithdrawalFlowException(
                StatusCodes.Status400BadRequest,
                "WITHDRAW_UNAVAILABLE_IN_CURRENT_MODE",
                $"O modo {_blockchainOptions.Mode} ainda nao suporta withdraw on-chain automatico.");
        }

        if (_blockchainOptions.Mode == BlockchainOperationMode.FullOnChain)
        {
            throw new WithdrawalFlowException(
                StatusCodes.Status400BadRequest,
                "WITHDRAW_MODE_NOT_IMPLEMENTED",
                "O modo FullOnChain ainda nao suporta withdraw automatico validado pelo backend.");
        }

        if (string.IsNullOrWhiteSpace(signature))
        {
            if (_blockchainOptions.IsOffChainCustodyMode)
            {
                ValidateWalletProof(request, authenticatedUser.Wallet, amount);
            }
            else
            {
                throw new WithdrawalFlowException(StatusCodes.Status400BadRequest, "MISSING_ONCHAIN_SIGNATURE", "A assinatura on-chain do resgate e obrigatoria.");
            }
        }

        var strategy = _context.Database.CreateExecutionStrategy();
        WalletActionResultDto? response = null;

        try
        {
            await strategy.ExecuteAsync(async () =>
            {
                await using var transaction = await _context.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);

                try
                {
                    var user = await _context.User.FirstOrDefaultAsync(x => x.UserID == authenticatedUser.UserID, ct)
                        ?? throw new WithdrawalFlowException(StatusCodes.Status401Unauthorized, "UNAUTHENTICATED", "Usuario autenticado nao encontrado.");

                    if (user.Balance < amount)
                        throw new WithdrawalFlowException(StatusCodes.Status400BadRequest, "INSUFFICIENT_SYSTEM_BALANCE", "Saldo insuficiente.");

                    if (!string.IsNullOrWhiteSpace(signature) && await HasSignatureBeenCompletedAsync(signature, ct))
                        throw new WithdrawalFlowException(StatusCodes.Status409Conflict, "DUPLICATE_SIGNATURE", "Essa assinatura ja foi utilizada em um resgate anterior.");

                    await _ledgerService.AddEntryAsync(
                        user,
                        PendingLedgerType,
                        0m,
                        user.Balance,
                        user.Balance,
                        description: BuildLedgerDescription(requestMarker, amount, connectedWallet, "requested", null),
                        ct: ct);

                    if (_blockchainOptions.IsOffChainCustodyMode)
                    {
                        signature = await _custodySolTransferService.TransferAsync(user.Wallet, amount, ct);
                    }

                    var verification = await _withdrawalVerifier.VerifyAsync(signature!, user.Wallet, amount, ct);
                    if (!verification.Succeeded)
                        throw new WithdrawalFlowException(StatusCodes.Status400BadRequest, verification.Code, verification.Message);

                    if (await HasSignatureBeenCompletedAsync(signature!, ct))
                        throw new WithdrawalFlowException(StatusCodes.Status409Conflict, "DUPLICATE_SIGNATURE", "Essa assinatura ja foi utilizada em um resgate anterior.");

                    var balanceBefore = user.Balance;
                    user.Balance = RoundMoney(user.Balance - amount);
                    user.TotalWithdrawn = RoundMoney(user.TotalWithdrawn + amount);
                    user.DtUpdate = DateTime.UtcNow;
                    await _context.SaveChangesAsync(ct);

                    await _ledgerService.AddEntryAsync(
                        user,
                        CompletedLedgerType,
                        -amount,
                        balanceBefore,
                        user.Balance,
                        description: BuildLedgerDescription(
                        signature!,
                        amount,
                        connectedWallet,
                        "confirmed",
                            $"cluster={verification.Cluster}; destination={verification.DestinationWallet}; lamports={verification.Lamports}"),
                        ct: ct);

                    await transaction.CommitAsync(ct);

                    _logger.LogInformation(
                        "[CRYPTO_WITHDRAW][API] withdraw confirmed. UserId={UserId} Wallet={Wallet} Amount={Amount} Signature={Signature} Cluster={Cluster}",
                        user.UserID,
                        user.Wallet,
                        amount,
                        signature!,
                        verification.Cluster);

                    response = new WalletActionResultDto
                    {
                        ProcessedAmount = amount,
                        SystemBalance = user.Balance,
                        AvailableReturns = 0m,
                        OnChainSignature = signature,
                        Message = "Resgate concluido."
                    };
                }
                catch
                {
                    await transaction.RollbackAsync(ct);
                    throw;
                }
            });
        }
        catch (WithdrawalFlowException ex)
        {
            await TryRegisterFailureAsync(authenticatedUser, requestMarker, amount, connectedWallet, ex.Code, ex.Message, ct);
            throw;
        }
        catch (Exception ex)
        {
            await TryRegisterFailureAsync(authenticatedUser, requestMarker, amount, connectedWallet, "WITHDRAW_UNEXPECTED_FAILURE", ex.Message, ct);
            throw;
        }

        return response!;
    }

    public async Task<AdminSystemBalanceWithdrawDiagnosticsDto> BuildDiagnosticsAsync(CancellationToken ct = default)
    {
        var users = await _context.User
            .AsNoTracking()
            .Where(x => x.Balance > 0m)
            .OrderByDescending(x => x.Balance)
            .ToListAsync(ct);

        var userIds = users.Select(x => x.UserID).ToList();
        var ledgerRows = await _context.Ledger
            .AsNoTracking()
            .Where(x => userIds.Contains(x.UserId) &&
                        (x.Type == PendingLedgerType
                         || x.Type == FailedLedgerType
                         || x.Type == CompletedLedgerType
                         || x.Type == CancelledLedgerType))
            .OrderByDescending(x => x.CreatedAt)
            .ToListAsync(ct);

        var items = users.Select(user =>
        {
            var rows = ledgerRows.Where(x => x.UserId == user.UserID).ToList();
            var last = rows.FirstOrDefault();
            var retryStatus = user.Balance > 0m
                ? rows.Any(x => x.Type == FailedLedgerType || x.Type == CancelledLedgerType)
                    ? "RetryAllowed"
                    : "AvailableForWithdraw"
                : "NoBalance";

            return new AdminSystemBalanceWithdrawDiagnosticItemDto
            {
                UserId = user.UserID,
                Wallet = user.Wallet,
                SystemBalance = user.Balance,
                TotalWithdrawn = user.TotalWithdrawn,
                RetryStatus = retryStatus,
                PendingAttempts = rows.Count(x => x.Type == PendingLedgerType),
                FailedAttempts = rows.Count(x => x.Type == FailedLedgerType || x.Type == CancelledLedgerType),
                LastAttemptAtUtc = last?.CreatedAt,
                LastAttemptType = last?.Type,
                LastAttemptDescription = last?.Description
            };
        }).ToList();

        return new AdminSystemBalanceWithdrawDiagnosticsDto
        {
            GeneratedAtUtc = DateTime.UtcNow,
            BlockchainMode = _blockchainOptions.Mode.ToString(),
            Items = items
        };
    }

    internal async Task<bool> HasSignatureBeenCompletedAsync(string signature, CancellationToken ct)
    {
        var marker = BuildSignatureMarker(signature);
        return await _context.Ledger
            .AsNoTracking()
            .AnyAsync(x => x.Type == CompletedLedgerType
                           && x.Description != null
                           && EF.Functions.Like(x.Description, $"%{marker}%"), ct);
    }

    internal static string BuildLedgerDescription(
        string signature,
        decimal amount,
        string connectedWallet,
        string status,
        string? extra)
    {
        var builder = new StringBuilder();
        builder.Append(BuildSignatureMarker(signature));
        builder.Append(" amount=").Append(amount.ToString("0.########", CultureInfo.InvariantCulture)).Append(';');
        builder.Append(" connectedWallet=").Append(connectedWallet).Append(';');
        builder.Append(" status=").Append(status).Append(';');

        if (!string.IsNullOrWhiteSpace(extra))
            builder.Append(' ').Append(extra.Trim()).Append(';');

        return builder.ToString();
    }

    private async Task TryRegisterFailureAsync(
        User authenticatedUser,
        string signature,
        decimal amount,
        string connectedWallet,
        string code,
        string message,
        CancellationToken ct)
    {
        try
        {
            var user = await _context.User.FirstOrDefaultAsync(x => x.UserID == authenticatedUser.UserID, ct);
            if (user is null)
                return;

            await _ledgerService.AddEntryAsync(
                user,
                FailedLedgerType,
                0m,
                user.Balance,
                user.Balance,
                description: BuildLedgerDescription(signature, amount, connectedWallet, "failed", $"code={code}; detail={message}"),
                ct: ct);
        }
        catch (Exception ledgerEx)
        {
            _logger.LogWarning(ledgerEx, "[CRYPTO_WITHDRAW][API] failed to register withdraw failure for user {UserId}", authenticatedUser.UserID);
        }
    }

    internal static string BuildSignatureMarker(string signature)
        => $"signature={signature};";

    private static decimal RoundMoney(decimal value)
        => Math.Round(value, 8, MidpointRounding.ToZero);

    private static void ValidateWalletProof(WithdrawSystemBalanceRequest request, string expectedWallet, decimal amount)
    {
        if (string.IsNullOrWhiteSpace(request.WalletProofMessage) || string.IsNullOrWhiteSpace(request.WalletProofSignature))
            throw new WithdrawalFlowException(StatusCodes.Status400BadRequest, "MISSING_WALLET_PROOF", "A wallet precisa assinar a autorizacao do saque.");

        var message = request.WalletProofMessage!;
        if (!message.Contains(expectedWallet, StringComparison.Ordinal)
            || !message.Contains(amount.ToString("0.########", CultureInfo.InvariantCulture), StringComparison.Ordinal))
        {
            throw new WithdrawalFlowException(StatusCodes.Status400BadRequest, "INVALID_WALLET_PROOF", "A prova assinada da wallet nao corresponde ao saque solicitado.");
        }

        try
        {
            _ = Base58Decode(request.ConnectedWalletPublicKey ?? expectedWallet);
            _ = Convert.FromBase64String(request.WalletProofSignature!);
        }
        catch (Exception)
        {
            throw new WithdrawalFlowException(StatusCodes.Status400BadRequest, "INVALID_WALLET_PROOF", "A assinatura da wallet nao foi validada.");
        }
    }

    private static byte[] Base58Decode(string value)
    {
        const string alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
        var output = new List<byte> { 0 };

        foreach (var c in value)
        {
            var carry = alphabet.IndexOf(c);
            if (carry < 0)
                throw new FormatException("Base58 invalido.");

            for (var i = 0; i < output.Count; i++)
            {
                var current = output[i] * 58 + carry;
                output[i] = (byte)(current & 0xff);
                carry = current >> 8;
            }

            while (carry > 0)
            {
                output.Add((byte)(carry & 0xff));
                carry >>= 8;
            }
        }

        foreach (var _ in value.TakeWhile(ch => ch == '1'))
            output.Add(0);

        output.Reverse();
        return output.ToArray();
    }

    private static string ComputeHash(string value)
    {
        using var sha = SHA256.Create();
        return Convert.ToHexString(sha.ComputeHash(Encoding.UTF8.GetBytes(value)));
    }
}

public sealed class OnChainWithdrawalVerifier : IOnChainWithdrawalVerifier
{
    private const int MaxConfirmationAttempts = 8;
    private static readonly TimeSpan ConfirmationRetryDelay = TimeSpan.FromSeconds(2);

    private readonly HttpClient _httpClient;
    private readonly CriptoVersusBlockchainOptions _options;
    private readonly ILogger<OnChainWithdrawalVerifier> _logger;

    public OnChainWithdrawalVerifier(
        HttpClient httpClient,
        IOptions<CriptoVersusBlockchainOptions> options,
        ILogger<OnChainWithdrawalVerifier> logger)
    {
        _httpClient = httpClient;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<OnChainWithdrawalVerificationResult> VerifyAsync(
        string signature,
        string expectedWallet,
        decimal expectedAmount,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_options.RpcUrl))
            return OnChainWithdrawalVerificationResult.Failure("RPC_NOT_CONFIGURED", "RpcUrl nao configurada para validacao do withdraw.");

        var lamportsExpected = ToLamports(expectedAmount);
        using var document = await FetchTransactionWithRetryAsync(signature, ct);
        var root = document.RootElement.Clone();

        if (root.TryGetProperty("error", out var errorElement))
        {
            _logger.LogWarning("[CRYPTO_WITHDRAW][API] RPC error for signature {Signature}: {Error}", signature, errorElement.ToString());
            return OnChainWithdrawalVerificationResult.Failure("RPC_FAILURE", "Falha RPC ao validar a transacao de withdraw.");
        }

        if (!root.TryGetProperty("result", out var resultElement) || resultElement.ValueKind == JsonValueKind.Null)
        {
            return OnChainWithdrawalVerificationResult.Failure(
                "SIGNATURE_NOT_FOUND",
                "A assinatura informada nao existe na rede Solana ou ainda nao foi confirmada.");
        }

        if (resultElement.TryGetProperty("meta", out var metaElement)
            && metaElement.TryGetProperty("err", out var txErrorElement)
            && txErrorElement.ValueKind != JsonValueKind.Null)
        {
            return OnChainWithdrawalVerificationResult.Failure("SIGNATURE_NOT_CONFIRMED", "A transacao on-chain falhou e nao pode ser usada no resgate.");
        }

        if (!resultElement.TryGetProperty("transaction", out var transactionElement)
            || !transactionElement.TryGetProperty("message", out var messageElement))
        {
            return OnChainWithdrawalVerificationResult.Failure("INVALID_TRANSACTION_FORMAT", "Formato da transacao Solana invalido para validacao.");
        }

        if (!messageElement.TryGetProperty("accountKeys", out var accountKeysElement)
            || accountKeysElement.ValueKind != JsonValueKind.Array)
        {
            return OnChainWithdrawalVerificationResult.Failure("INVALID_TRANSACTION_FORMAT", "A transacao nao possui accountKeys validas.");
        }

        var accountKeys = ReadAccountKeys(accountKeysElement);
        if (!accountKeys.Contains(expectedWallet, StringComparer.Ordinal))
            return OnChainWithdrawalVerificationResult.Failure("WALLET_MISMATCH", "A transacao nao pertence a wallet autenticada.");

        var valid = _options.IsOffChainCustodyMode
            ? TryFindMatchingOffChainTransferInstruction(messageElement, expectedWallet, lamportsExpected, out var destinationWallet)
            : TryFindMatchingWithdrawInstruction(messageElement, expectedWallet, lamportsExpected, out destinationWallet);

        if (!valid)
        {
            return OnChainWithdrawalVerificationResult.Failure(
                "WITHDRAW_PROOF_INVALID",
                "A assinatura informada nao comprovou um withdraw valido para a wallet e o valor solicitados.");
        }

        _logger.LogInformation(
            "[CRYPTO_WITHDRAW][API] withdrawal proof verified. Wallet={Wallet} Cluster={Cluster} AmountLamports={Lamports} Destination={Destination} Signature={Signature}",
            expectedWallet,
            _options.Cluster,
            lamportsExpected,
            destinationWallet,
            signature);

        return OnChainWithdrawalVerificationResult.Success(
            "Withdraw on-chain validado com sucesso.",
            _options.Cluster,
            destinationWallet,
            lamportsExpected);
    }

    private async Task<JsonDocument> FetchTransactionWithRetryAsync(string signature, CancellationToken ct)
    {
        for (var attempt = 1; attempt <= MaxConfirmationAttempts; attempt++)
        {
            var document = await FetchTransactionAsync(signature, ct);
            var root = document.RootElement;

            if (root.TryGetProperty("error", out var errorElement))
            {
                _logger.LogWarning(
                    "[CRYPTO_WITHDRAW][API] RPC error validating signature {Signature} on attempt {Attempt}/{MaxAttempts}: {Error}",
                    signature,
                    attempt,
                    MaxConfirmationAttempts,
                    errorElement.ToString());
                return document;
            }

            if (root.TryGetProperty("result", out var resultElement) && resultElement.ValueKind != JsonValueKind.Null)
            {
                if (attempt > 1)
                {
                    _logger.LogInformation(
                        "[CRYPTO_WITHDRAW][API] signature {Signature} became available on attempt {Attempt}/{MaxAttempts}.",
                        signature,
                        attempt,
                        MaxConfirmationAttempts);
                }

                return document;
            }

            if (attempt < MaxConfirmationAttempts)
            {
                _logger.LogInformation(
                    "[CRYPTO_WITHDRAW][API] signature {Signature} not available yet on attempt {Attempt}/{MaxAttempts}. Waiting {DelaySeconds}s before retry.",
                    signature,
                    attempt,
                    MaxConfirmationAttempts,
                    ConfirmationRetryDelay.TotalSeconds);
                document.Dispose();
                await Task.Delay(ConfirmationRetryDelay, ct);
                continue;
            }

            return document;
        }

        throw new InvalidOperationException("Falha inesperada ao validar confirmacao do saque.");
    }

    private async Task<JsonDocument> FetchTransactionAsync(string signature, CancellationToken ct)
    {
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

        var response = await _httpClient.PostAsJsonAsync(_options.RpcUrl, requestBody, ct);
        if (!response.IsSuccessStatusCode)
        {
            response.Dispose();
            using var errorDocument = JsonDocument.Parse("{\"error\":\"http_failure\"}");
            _logger.LogWarning("[CRYPTO_WITHDRAW][API] RPC returned HTTP failure for signature {Signature}.", signature);
            return JsonDocument.Parse("{\"error\":{\"message\":\"http_failure\"}}");
        }

        await using var responseStream = await response.Content.ReadAsStreamAsync(ct);
        var document = await JsonDocument.ParseAsync(responseStream, cancellationToken: ct);
        response.Dispose();
        return document;
    }

    private bool TryFindMatchingWithdrawInstruction(
        JsonElement messageElement,
        string expectedWallet,
        long expectedLamports,
        out string destinationWallet)
    {
        destinationWallet = expectedWallet;

        if (!messageElement.TryGetProperty("instructions", out var instructionsElement)
            || instructionsElement.ValueKind != JsonValueKind.Array)
            return false;

        foreach (var instruction in instructionsElement.EnumerateArray())
        {
            var programId = instruction.TryGetProperty("programId", out var programIdElement)
                ? programIdElement.GetString()
                : null;

            if (!string.Equals(programId, _options.GetActiveProgramId(), StringComparison.Ordinal))
                continue;

            if (!instruction.TryGetProperty("accounts", out var accountsElement)
                || accountsElement.ValueKind != JsonValueKind.Array)
                continue;

            var accounts = accountsElement.EnumerateArray()
                .Select(x => x.GetString())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Cast<string>()
                .ToList();

            if (!accounts.Contains(expectedWallet, StringComparer.Ordinal))
                continue;

            if (!instruction.TryGetProperty("data", out var dataElement))
                continue;

            var data = dataElement.GetString();
            if (string.IsNullOrWhiteSpace(data))
                continue;

            if (!TryDecodeWithdrawPayload(data, out var lamports))
                continue;

            if (lamports != expectedLamports)
                continue;

            destinationWallet = expectedWallet;
            return true;
        }

        return false;
    }

    private bool TryFindMatchingOffChainTransferInstruction(
        JsonElement messageElement,
        string expectedWallet,
        long expectedLamports,
        out string destinationWallet)
    {
        destinationWallet = expectedWallet;

        if (!messageElement.TryGetProperty("instructions", out var instructionsElement)
            || instructionsElement.ValueKind != JsonValueKind.Array)
            return false;

        foreach (var instruction in instructionsElement.EnumerateArray())
        {
            var program = instruction.TryGetProperty("program", out var programElement)
                ? programElement.GetString()
                : null;
            if (!string.Equals(program, "system", StringComparison.OrdinalIgnoreCase))
                continue;

            if (!instruction.TryGetProperty("parsed", out var parsedElement)
                || !parsedElement.TryGetProperty("type", out var typeElement)
                || !string.Equals(typeElement.GetString(), "transfer", StringComparison.OrdinalIgnoreCase)
                || !parsedElement.TryGetProperty("info", out var infoElement))
            {
                continue;
            }

            var source = infoElement.TryGetProperty("source", out var sourceElement) ? sourceElement.GetString() : null;
            var destination = infoElement.TryGetProperty("destination", out var destinationElement) ? destinationElement.GetString() : null;
            if (!string.Equals(source, _options.CustodyWalletPublicKey, StringComparison.Ordinal)
                || !string.Equals(destination, expectedWallet, StringComparison.Ordinal))
            {
                continue;
            }

            if (!infoElement.TryGetProperty("lamports", out var lamportsElement))
                continue;

            var lamports = lamportsElement.ValueKind == JsonValueKind.String
                ? long.Parse(lamportsElement.GetString()!)
                : lamportsElement.GetInt64();

            if (lamports != expectedLamports)
                continue;

            destinationWallet = destination!;
            return true;
        }

        return false;
    }

    private static HashSet<string> ReadAccountKeys(JsonElement accountKeysElement)
    {
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var accountKey in accountKeysElement.EnumerateArray())
        {
            switch (accountKey.ValueKind)
            {
                case JsonValueKind.String:
                    keys.Add(accountKey.GetString()!);
                    break;
                case JsonValueKind.Object when accountKey.TryGetProperty("pubkey", out var pubkeyElement):
                    if (!string.IsNullOrWhiteSpace(pubkeyElement.GetString()))
                        keys.Add(pubkeyElement.GetString()!);
                    break;
            }
        }

        return keys;
    }

    private static bool TryDecodeWithdrawPayload(string encodedData, out long lamports)
    {
        lamports = 0;
        try
        {
            var bytes = Base58Decode(encodedData);
            if (bytes.Length < 16)
                return false;

            var expectedDiscriminator = GetWithdrawDiscriminator();
            for (var i = 0; i < expectedDiscriminator.Length; i++)
            {
                if (bytes[i] != expectedDiscriminator[i])
                    return false;
            }

            lamports = BitConverter.ToInt64(bytes, 8);
            return lamports > 0;
        }
        catch
        {
            return false;
        }
    }

    private static byte[] GetWithdrawDiscriminator()
    {
        using var sha = SHA256.Create();
        var hash = sha.ComputeHash(Encoding.UTF8.GetBytes("global:withdraw"));
        return hash.Take(8).ToArray();
    }

    private static long ToLamports(decimal amount)
        => (long)Math.Round(amount * 1_000_000_000m, 0, MidpointRounding.ToZero);

    private static byte[] Base58Decode(string value)
    {
        const string alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
        var output = new List<byte> { 0 };

        foreach (var c in value)
        {
            var carry = alphabet.IndexOf(c);
            if (carry < 0)
                throw new FormatException("Base58 invalido.");

            for (var i = 0; i < output.Count; i++)
            {
                var current = output[i] * 58 + carry;
                output[i] = (byte)(current & 0xff);
                carry = current >> 8;
            }

            while (carry > 0)
            {
                output.Add((byte)(carry & 0xff));
                carry >>= 8;
            }
        }

        foreach (var _ in value.TakeWhile(ch => ch == '1'))
            output.Add(0);

        output.Reverse();
        return output.ToArray();
    }

    private static decimal RoundMoney(decimal value)
        => Math.Round(value, 8, MidpointRounding.ToZero);
}

public sealed class WithdrawalFlowException : Exception
{
    public WithdrawalFlowException(int statusCode, string code, string message)
        : base(message)
    {
        StatusCode = statusCode;
        Code = code;
    }

    public int StatusCode { get; }
    public string Code { get; }
}
