namespace DTOs;

public sealed class ClaimAvailableReturnsRequest
{
    public string? OnChainSignature { get; set; }
}

public sealed class WithdrawSystemBalanceRequest
{
    public decimal Amount { get; set; }
    public string? OnChainSignature { get; set; }
}

public sealed class WalletActionResultDto
{
    public decimal ProcessedAmount { get; set; }
    public decimal SystemBalance { get; set; }
    public decimal AvailableReturns { get; set; }
    public string? OnChainSignature { get; set; }
    public string Message { get; set; } = string.Empty;
}
