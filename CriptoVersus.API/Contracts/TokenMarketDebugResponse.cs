namespace CriptoVersus.API.Contracts;

public sealed record TokenMarketDebugResponse(
    string ContractAddress,
    DateTimeOffset CheckedAtUtc,
    string FinalSource,
    string FinalStatus,
    IReadOnlyList<TokenMarketDebugAttemptResponse> Attempts);

public sealed record TokenMarketDebugAttemptResponse(
    string Source,
    string Url,
    int? HttpStatusCode,
    bool Success,
    bool HasData,
    string Message,
    long ElapsedMs);
