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

public sealed class AdminSystemBalanceWithdrawDiagnosticsDto
{
    public DateTime GeneratedAtUtc { get; set; }
    public string BlockchainMode { get; set; } = "";
    public List<AdminSystemBalanceWithdrawDiagnosticItemDto> Items { get; set; } = [];
}

public sealed class AdminSystemBalanceWithdrawDiagnosticItemDto
{
    public int UserId { get; set; }
    public string Wallet { get; set; } = "";
    public decimal SystemBalance { get; set; }
    public decimal TotalWithdrawn { get; set; }
    public string RetryStatus { get; set; } = "";
    public int PendingAttempts { get; set; }
    public int FailedAttempts { get; set; }
    public DateTime? LastAttemptAtUtc { get; set; }
    public string? LastAttemptType { get; set; }
    public string? LastAttemptDescription { get; set; }
}
