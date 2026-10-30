using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

public interface IMoneyFlowWorkerAuthenticationService
{
    bool IsAuthorized(HttpRequest request);
}

public sealed class MoneyFlowWorkerAuthenticationService(IOptions<MoneyFlowTransportOptions> options)
    : IMoneyFlowWorkerAuthenticationService
{
    public const string HeaderName = "X-Money-Flow-Worker-Key";

    public bool IsAuthorized(HttpRequest request)
    {
        var expected = options.Value.WorkerApiKey?.Trim();
        if (string.IsNullOrWhiteSpace(expected) || !request.Headers.TryGetValue(HeaderName, out var actual))
            return false;

        var expectedBytes = Encoding.UTF8.GetBytes(expected);
        var actualBytes = Encoding.UTF8.GetBytes(actual.ToString().Trim());
        return CryptographicOperations.FixedTimeEquals(expectedBytes, actualBytes);
    }
}
