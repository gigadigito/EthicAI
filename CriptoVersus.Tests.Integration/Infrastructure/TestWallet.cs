namespace CriptoVersus.Tests.Integration.Infrastructure;

public sealed record TestWallet(
    string Wallet,
    string Token,
    int UserId,
    decimal InitialBalance);
