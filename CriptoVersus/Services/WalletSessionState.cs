namespace CriptoVersus.Web.Services;

public sealed class WalletSessionState
{
    public string? AuthToken { get; private set; }
    public string? WalletPublicKey { get; private set; }

    public event Action? Changed;

    public void SetSession(string? authToken, string? walletPublicKey)
    {
        AuthToken = authToken;
        WalletPublicKey = walletPublicKey;
        Changed?.Invoke();
    }
}
