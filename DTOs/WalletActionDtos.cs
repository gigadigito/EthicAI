namespace DTOs;

public sealed class ClaimAvailableReturnsRequest
{
    public string? OnChainSignature { get; set; }
}

public sealed class WithdrawSystemBalanceRequest
{
    public decimal Amount { get; set; }
    public string? OnChainSignature { get; set; }
    public string? ConnectedWalletPublicKey { get; set; }
    public string? WalletProofMessage { get; set; }
    public string? WalletProofSignature { get; set; }
}

public sealed class WalletActionResultDto
{
    public decimal ProcessedAmount { get; set; }
    public decimal SystemBalance { get; set; }
    public decimal AvailableReturns { get; set; }
    public string? OnChainSignature { get; set; }
    public string Message { get; set; } = string.Empty;
}

public sealed class OpenDirectPositionRequest
{
    public string Symbol { get; set; } = string.Empty;
    public decimal AmountSol { get; set; }
    public string Signature { get; set; } = string.Empty;
    public string WalletAddress { get; set; } = string.Empty;
}

public sealed class OpenDirectPositionResultDto
{
    public string Symbol { get; set; } = string.Empty;
    public decimal AmountSol { get; set; }
    public string Signature { get; set; } = string.Empty;
    public string WalletAddress { get; set; } = string.Empty;
    public string CustodyWalletPublicKey { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public TeamPositionDto Position { get; set; } = new();
}
