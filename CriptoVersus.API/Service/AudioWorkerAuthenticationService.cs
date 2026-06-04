using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

public interface IAudioWorkerAuthenticationService
{
    bool IsAuthorized(HttpRequest request);
}

public sealed class AudioWorkerAuthenticationService : IAudioWorkerAuthenticationService
{
    public const string HeaderName = "X-Audio-Worker-Key";

    private readonly IOptions<AudioGenerationOptions> _options;

    public AudioWorkerAuthenticationService(IOptions<AudioGenerationOptions> options)
    {
        _options = options;
    }

    public bool IsAuthorized(HttpRequest request)
    {
        var expected = _options.Value.WorkerKey?.Trim();
        if (string.IsNullOrWhiteSpace(expected))
            return false;

        if (!request.Headers.TryGetValue(HeaderName, out var actual))
            return false;

        return string.Equals(expected, actual.ToString().Trim(), StringComparison.Ordinal);
    }
}
