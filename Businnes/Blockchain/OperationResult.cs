namespace BLL.Blockchain;

public sealed class OperationResult
{
    public bool Succeeded { get; init; }
    public string Message { get; init; } = string.Empty;
    public string? Code { get; init; }
    public string? TransactionSignature { get; init; }
    public decimal? Amount { get; init; }
    public decimal? BalanceBefore { get; init; }
    public decimal? BalanceAfter { get; init; }
    public int? ReferenceId { get; init; }
    public Dictionary<string, string> Metadata { get; init; } = [];

    public static OperationResult Success(
        string message,
        string? code = null,
        string? transactionSignature = null,
        decimal? amount = null,
        decimal? balanceBefore = null,
        decimal? balanceAfter = null,
        int? referenceId = null,
        Dictionary<string, string>? metadata = null)
        => new()
        {
            Succeeded = true,
            Message = message,
            Code = code,
            TransactionSignature = transactionSignature,
            Amount = amount,
            BalanceBefore = balanceBefore,
            BalanceAfter = balanceAfter,
            ReferenceId = referenceId,
            Metadata = metadata ?? []
        };

    public static OperationResult Failure(string message, string? code = null)
        => new()
        {
            Succeeded = false,
            Message = message,
            Code = code
        };
}
