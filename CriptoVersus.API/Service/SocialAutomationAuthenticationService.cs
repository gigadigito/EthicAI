using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

/// <summary>
/// Nomes estaveis do mecanismo de autenticacao de automacoes sociais (n8n):
/// scheme de autenticacao por chave, politica de autorizacao e header HTTP.
/// </summary>
public static class SocialAutomationDefaults
{
    public const string AuthenticationScheme = "SocialAutomationKey";
    public const string PolicyName = "SocialAutomation";
    public const string HeaderName = "X-Social-Key";
    public const string PrincipalName = "social-automation";
    public const string ChallengeMessage = "Chave de automacao invalida. Informe X-Social-Key ou use JWT.";
}

public interface ISocialAutomationAuthenticationService
{
    /// <summary>
    /// Valida uma chave de automacao contra <c>SocialAutomation:ApiKey</c>.
    /// Sempre retorna <c>false</c> para chave ausente, vazia ou quando a chave
    /// esperada nao esta configurada (fail-closed).
    /// </summary>
    bool IsValidKey(string? providedKey);

    /// <summary>Valida o header <c>X-Social-Key</c> da requisicao.</summary>
    bool HasValidKey(HttpRequest request);
}

/// <summary>
/// Validacao de chave de automacao social. A comparacao e de tempo constante e o
/// valor da chave nunca aparece em retorno, log ou diagnostico.
/// </summary>
public sealed class SocialAutomationAuthenticationService : ISocialAutomationAuthenticationService
{
    private readonly IOptions<SocialAutomationOptions> _options;

    public SocialAutomationAuthenticationService(IOptions<SocialAutomationOptions> options)
    {
        _options = options;
    }

    public bool HasValidKey(HttpRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        var providedKey = request.Headers.TryGetValue(SocialAutomationDefaults.HeaderName, out var values)
            ? values.ToString()
            : null;

        return IsValidKey(providedKey);
    }

    public bool IsValidKey(string? providedKey)
    {
        if (string.IsNullOrWhiteSpace(providedKey))
            return false;

        var expectedKey = _options.Value.ApiKey?.Trim();
        if (string.IsNullOrWhiteSpace(expectedKey))
            return false;

        return FixedTimeEquals(expectedKey, providedKey.Trim());
    }

    private static bool FixedTimeEquals(string expectedKey, string providedKey)
    {
        var expectedHash = SHA256.HashData(Encoding.UTF8.GetBytes(expectedKey));
        var providedHash = SHA256.HashData(Encoding.UTF8.GetBytes(providedKey));
        return CryptographicOperations.FixedTimeEquals(expectedHash, providedHash);
    }
}
