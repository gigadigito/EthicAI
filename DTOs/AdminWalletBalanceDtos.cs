namespace DTOs;

public sealed class AdminWalletCreditTestBalanceRequestDto
{
    public string Wallet { get; set; } = "";
    public decimal Amount { get; set; }
    public string? Reason { get; set; }
}

public sealed class AdminWalletManualAdjustmentRequestDto
{
    public string Wallet { get; set; } = "";
    public decimal Amount { get; set; }
    public string Direction { get; set; } = "";
    public string? Reason { get; set; }
}

public sealed class AdminWalletBalanceAdjustmentResponseDto
{
    public int UserId { get; set; }
    public string Wallet { get; set; } = "";
    public string Direction { get; set; } = "";
    public string Reason { get; set; } = "";
    public decimal Amount { get; set; }
    public decimal BalanceBefore { get; set; }
    public decimal BalanceAfter { get; set; }
    public bool CreatedUser { get; set; }
}
